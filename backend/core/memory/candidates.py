import json
import re
import time
import uuid
from typing import Any

from db.database import get_db


CHAPTER_DIR_PREFIX = "正文/"


async def queue_chapter_knowledge_candidates(project_id: str, file_path: str, content: str, provider: Any | None = None) -> list[str]:
    """Create structured knowledge candidates after a chapter is approved."""
    if not file_path.startswith(CHAPTER_DIR_PREFIX) or not file_path.endswith(".md"):
        return []

    candidates = []
    extraction_source = "local_rule"
    if provider is not None:
        candidates = await extract_chapter_candidates_with_model(provider, project_id, file_path, content)
        if candidates:
            extraction_source = "model_analysis"
    if not candidates:
        candidates = await extract_chapter_candidates(project_id, file_path, content)
        extraction_source = "local_rule"
    if not candidates:
        return []

    now = int(time.time())
    created: list[str] = []
    db = await get_db(project_id)
    try:
        for candidate in candidates:
            candidate_type = candidate["candidate_type"]
            payload = candidate["payload"]
            payload.setdefault("extraction_source", extraction_source)
            if await _candidate_exists(db, project_id, file_path, candidate_type, payload):
                continue
            candidate_id = str(uuid.uuid4())[:8]
            await db.execute(
                """INSERT INTO knowledge_candidates
                   (id, project_id, source_file_path, candidate_type, payload, status, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)""",
                (
                    candidate_id,
                    project_id,
                    file_path,
                    candidate_type,
                    json.dumps(payload, ensure_ascii=False),
                    now,
                    now,
                ),
            )
            created.append(candidate_id)
        await db.commit()
    finally:
        await db.close()
    return created


async def extract_chapter_candidates_with_model(provider: Any, project_id: str, file_path: str, content: str) -> list[dict[str, Any]]:
    """Use the configured model for structured extraction, falling back silently on parse/API errors."""
    title = _chapter_title(file_path, content)
    prompt = f"""请分析下面小说章节，抽取待用户确认的知识候选。

必须只输出 JSON，不要 Markdown 代码块。JSON 格式：
{{
  "candidates": [
    {{
      "candidate_type": "chapter_summary|character_state|timeline_event|foreshadowing|world_setting",
      "payload": {{
        "title": "章节摘要标题，仅 chapter_summary 使用",
        "name": "候选名称，非摘要类型使用",
        "summary": "简短摘要",
        "description": "事件/伏笔/状态/设定说明",
        "current_state": "角色本章结束后的状态，仅 character_state 使用",
        "location": "角色本章结束时所在地点，仅 character_state 使用",
        "goal": "角色下一步目标，仅 character_state 使用",
        "emotion": "角色主要情绪，仅 character_state 使用",
        "health": "伤势/体力/精神状态，仅 character_state 使用",
        "abilities": "能力/装备/功法变化，仅 character_state 使用",
        "relationships": "关系变化，仅 character_state 使用",
        "characters": [],
        "key_events": [],
        "foreshadowing": [],
        "evidence": "原文证据片段，必须来自章节",
        "confidence": 0.0,
        "target_type": "chapter_summary|character|timeline_event|foreshadowing|knowledge_node",
        "target_id": "",
        "suggested_update": "用户确认后建议写入哪里"
      }}
    }}
  ]
}}

约束：
- 候选必须等待用户确认，不能写成已生效事实。
- evidence 必须是章节里的短句或短段落。
- confidence 使用 0 到 1 的数字。
- 候选数量控制在 3 到 12 条。

章节路径：{file_path}
章节标题：{title}

章节正文：
{content[:12000]}"""
    try:
        raw = await provider.chat(
            messages=[
                {"role": "system", "content": "你是小说章节知识抽取器，只输出可解析 JSON。"},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
        )
    except Exception:
        return []
    return _normalize_model_candidates(file_path, raw)


async def extract_chapter_candidates(project_id: str, file_path: str, content: str) -> list[dict[str, Any]]:
    title = _chapter_title(file_path, content)
    summary = _summary(content)
    evidence = _evidence(content)
    candidates: list[dict[str, Any]] = [
        _candidate(
            "chapter_summary",
            file_path,
            {
                "title": title,
                "summary": summary,
                "characters": await _mentioned_characters(project_id, content),
                "key_events": _key_events(content),
                "foreshadowing": _foreshadow_hints(content),
            },
            evidence,
            0.82,
            "chapter_summary",
        )
    ]

    for character in await _mentioned_characters(project_id, content):
        state_payload = _local_character_state_payload(title, content, character)
        candidates.append(
            _candidate(
                "character_state",
                file_path,
                {
                    "name": character["name"],
                    "role": character.get("role") or "自动提取",
                    **state_payload,
                    "file_path": character.get("file_path"),
                },
                state_payload.get("evidence") or evidence,
                0.62,
                "character",
            )
        )

    for event in _key_events(content)[:5]:
        candidates.append(
            _candidate(
                "timeline_event",
                file_path,
                {
                    "name": event[:40] or title,
                    "description": event,
                    "status": "drafted",
                },
                event,
                0.66,
                "timeline_event",
            )
        )

    for hint in _foreshadow_hints(content)[:5]:
        candidates.append(
            _candidate(
                "foreshadowing",
                file_path,
                {
                    "name": hint[:40] or "未命名伏笔",
                    "description": hint,
                    "status": "planted",
                },
                hint,
                0.64,
                "foreshadowing",
            )
        )

    for setting in _world_settings(content)[:5]:
        candidates.append(
            _candidate(
                "world_setting",
                file_path,
                {
                    "name": setting[:40] or "未命名设定",
                    "summary": setting,
                    "detail": setting,
                    "category": "章节提取",
                    "tags": ["世界观", "章节提取"],
                },
                setting,
                0.6,
                "knowledge_node",
            )
        )

    return candidates


def _normalize_model_candidates(file_path: str, raw: str) -> list[dict[str, Any]]:
    data = _try_json(raw)
    if not isinstance(data, dict):
        return []
    items = data.get("candidates")
    if not isinstance(items, list):
        return []

    allowed = {"chapter_summary", "character_state", "timeline_event", "foreshadowing", "world_setting"}
    target_by_type = {
        "chapter_summary": "chapter_summary",
        "character_state": "character",
        "timeline_event": "timeline_event",
        "foreshadowing": "foreshadowing",
        "world_setting": "knowledge_node",
    }
    result: list[dict[str, Any]] = []
    for item in items[:12]:
        if not isinstance(item, dict):
            continue
        candidate_type = item.get("candidate_type")
        payload = item.get("payload")
        if candidate_type not in allowed or not isinstance(payload, dict):
            continue
        if candidate_type == "character_state" and not payload.get("current_state"):
            payload["current_state"] = payload.get("summary") or payload.get("description") or ""
        evidence = str(payload.get("evidence") or payload.get("description") or payload.get("summary") or "")[:400]
        confidence = payload.get("confidence", 0.6)
        try:
            confidence = max(0.0, min(1.0, float(confidence)))
        except (TypeError, ValueError):
            confidence = 0.6
        target_type = str(payload.get("target_type") or target_by_type[candidate_type])
        result.append(_candidate(candidate_type, file_path, payload, evidence, confidence, target_type))
    return result


def _try_json(raw: str) -> Any:
    text = (raw or "").strip().replace("```json", "").replace("```", "").strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None


def _candidate(candidate_type: str, file_path: str, payload: dict[str, Any], evidence: str, confidence: float, target_type: str) -> dict[str, Any]:
    payload = {
        **payload,
        "source_file_path": file_path,
        "evidence": evidence,
        "confidence": confidence,
        "target_type": target_type,
        "target_id": payload.get("target_id", ""),
        "suggested_update": payload.get("suggested_update") or _suggested_update(candidate_type),
    }
    return {"candidate_type": candidate_type, "payload": payload}


async def _candidate_exists(db, project_id: str, source_file_path: str, candidate_type: str, payload: dict[str, Any]) -> bool:
    rows = await db.execute_fetchall(
        """SELECT payload FROM knowledge_candidates
           WHERE project_id = ? AND source_file_path = ? AND candidate_type = ? AND status IN ('pending', 'approved')""",
        (project_id, source_file_path, candidate_type),
    )
    fingerprint = _fingerprint(payload)
    for row in rows:
        try:
            existing = json.loads(row["payload"]) if row["payload"] else {}
        except (json.JSONDecodeError, TypeError):
            existing = {}
        if _fingerprint(existing) == fingerprint:
            return True
    return False


def _fingerprint(payload: dict[str, Any]) -> str:
    keys = ("title", "name", "summary", "description", "target_type")
    return "|".join(str(payload.get(key, "")).strip()[:120] for key in keys)


async def _mentioned_characters(project_id: str, content: str) -> list[dict[str, Any]]:
    db = await get_db(project_id)
    try:
        rows = await db.execute_fetchall(
            "SELECT id, name, role, file_path FROM character_profiles WHERE project_id = ? ORDER BY created_at DESC LIMIT 50",
            (project_id,),
        )
    finally:
        await db.close()
    result = []
    for row in rows:
        name = row["name"]
        if name and name in content:
            result.append(dict(row))
    return result


def _chapter_title(file_path: str, content: str) -> str:
    for line in content.splitlines():
        clean = line.strip("# \t")
        if clean:
            return clean[:80]
    return file_path.rsplit("/", 1)[-1].replace(".md", "")


def _summary(content: str, limit: int = 500) -> str:
    compact = " ".join(line.strip() for line in content.splitlines() if line.strip())
    return compact[:limit]


def _evidence(content: str) -> str:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", content) if p.strip()]
    return (paragraphs[0] if paragraphs else _summary(content, 220))[:400]


def _near_text(content: str, needle: str, radius: int = 120) -> str:
    if not needle:
        return ""
    idx = content.find(needle)
    if idx < 0:
        return ""
    return content[max(0, idx - radius): idx + len(needle) + radius].strip()


def _local_character_state_payload(title: str, content: str, character: dict[str, Any]) -> dict[str, Any]:
    name = character["name"]
    near = _near_text(content, name) or _evidence(content)
    return {
        "summary": f"{name}在{title}中的状态变化待确认。",
        "description": near,
        "current_state": near[:500],
        "location": _infer_location(near),
        "goal": _infer_goal(near),
        "emotion": _infer_emotion(near),
        "health": _infer_health(near),
        "abilities": _infer_abilities(near),
        "relationships": "",
        "evidence": near[:400],
    }


def _infer_location(text: str) -> str:
    match = re.search(r"(?:去|到|进入|来到|赶往|留在|身处)([^，。；\s]{2,16})", text)
    return match.group(1) if match else ""


def _infer_goal(text: str) -> str:
    for pattern in (r"(查清[^，。；]{2,24})", r"(寻找[^，。；]{2,24})", r"(救出[^，。；]{2,24})", r"(夺回[^，。；]{2,24})"):
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    match = re.search(r"决定([^。；]{2,40})", text)
    return match.group(1).strip("，,。；; ") if match else ""


def _infer_health(text: str) -> str:
    pieces = _sentences_by_keywords(text, ("伤", "血", "疲惫", "昏迷", "中毒", "虚弱", "疼", "痛"), limit=2)
    return pieces[0] if pieces else ""


def _infer_emotion(text: str) -> str:
    for keyword in ("警惕", "愤怒", "恐惧", "犹豫", "震惊", "悲伤", "欣喜", "冷静", "焦急"):
        if keyword in text:
            return keyword
    return ""


def _infer_abilities(text: str) -> str:
    pieces = _sentences_by_keywords(text, ("突破", "功法", "法器", "灵力", "秘术", "能力", "黑玉"), limit=2)
    return pieces[0] if pieces else ""


def _key_events(content: str) -> list[str]:
    keywords = ("决定", "发现", "冲突", "战斗", "交易", "逃", "追", "进入", "离开", "暴露", "突破", "死亡", "相遇")
    return _sentences_by_keywords(content, keywords)


def _foreshadow_hints(content: str) -> list[str]:
    keywords = ("伏笔", "线索", "谜团", "秘密", "异常", "预感", "钩子", "未解", "古怪", "不对劲")
    return _sentences_by_keywords(content, keywords)


def _world_settings(content: str) -> list[str]:
    keywords = ("灵气", "境界", "功法", "宗门", "法器", "系统", "规则", "末世", "异能", "王朝", "城邦", "星舰")
    return _sentences_by_keywords(content, keywords)


def _sentences_by_keywords(content: str, keywords: tuple[str, ...], limit: int = 6) -> list[str]:
    pieces = re.split(r"(?<=[。！？!?；;])|\n+", content)
    result: list[str] = []
    for piece in pieces:
        text = piece.strip()
        if not text or len(text) < 8:
            continue
        if any(keyword in text for keyword in keywords):
            result.append(text[:240])
        if len(result) >= limit:
            break
    return result


def _suggested_update(candidate_type: str) -> str:
    labels = {
        "chapter_summary": "写入章节摘要表，并创建章节摘要知识节点",
        "character_state": "确认后更新人物档案或创建人物状态记录",
        "timeline_event": "确认后写入时间线事件",
        "foreshadowing": "确认后写入伏笔表",
        "world_setting": "确认后写入知识图谱世界观节点",
    }
    return labels.get(candidate_type, "确认后写入知识库")
