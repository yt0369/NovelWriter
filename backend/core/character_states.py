import json
import re
import time
import uuid
from typing import Any


STATE_PROFILE_FIELDS = (
    "current_state",
    "location",
    "goal",
    "emotion",
    "health",
    "abilities",
    "relationships",
)


def chapter_index_from_path(path: str) -> int | None:
    match = re.search(r"第\s*0*(\d+)\s*章", path or "")
    if not match:
        return None
    return int(match.group(1))


def character_state_summary(payload: dict[str, Any]) -> str:
    for key in ("current_state", "state_summary", "summary", "description", "status"):
        value = payload.get(key)
        if value:
            return _stringify_state_value(value)[:500]
    return ""


async def record_character_state(
    db,
    project_id: str,
    character_id: str,
    character_name: str,
    source_file_path: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    now = int(time.time())
    history_id = str(uuid.uuid4())[:8]
    state_summary = character_state_summary(payload)
    chapter_index = chapter_index_from_path(source_file_path)
    await db.execute(
        """INSERT INTO character_state_history
           (id, project_id, character_id, character_name, source_file_path, chapter_index,
            state_summary, location, goal, emotion, health, abilities, relationships,
            evidence, confidence, payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            history_id,
            project_id,
            character_id,
            character_name,
            source_file_path,
            chapter_index,
            state_summary,
            _stringify_state_value(payload.get("location")),
            _stringify_state_value(payload.get("goal")),
            _stringify_state_value(payload.get("emotion")),
            _stringify_state_value(payload.get("health")),
            _stringify_state_value(payload.get("abilities")),
            _stringify_state_value(payload.get("relationships")),
            _stringify_state_value(payload.get("evidence")),
            _float_or_none(payload.get("confidence")),
            json.dumps(payload, ensure_ascii=False),
            now,
        ),
    )
    await _merge_character_profile_state(
        db,
        project_id,
        character_id,
        payload,
        {
            "current_state": state_summary,
            "last_state_source_file_path": source_file_path,
            "last_state_chapter_index": chapter_index,
            "last_state_history_id": history_id,
        },
        now,
    )
    return {
        "id": history_id,
        "character_id": character_id,
        "character_name": character_name,
        "source_file_path": source_file_path,
        "chapter_index": chapter_index,
        "state_summary": state_summary,
    }


async def pending_character_state_conflicts(db, project_id: str, chapter_index: int) -> list[dict[str, Any]]:
    if chapter_index <= 1:
        return []
    rows = await db.execute_fetchall(
        """SELECT id, source_file_path, payload, created_at
           FROM knowledge_candidates
           WHERE project_id = ? AND status = 'pending' AND candidate_type = 'character_state'
           ORDER BY created_at DESC LIMIT 100""",
        (project_id,),
    )
    conflicts: list[dict[str, Any]] = []
    for row in rows:
        source_path = row["source_file_path"] or ""
        source_chapter = chapter_index_from_path(source_path)
        if source_chapter is None or source_chapter >= chapter_index:
            continue
        payload = _try_json_object(row["payload"] or "{}")
        character_name = str(payload.get("name") or payload.get("character_name") or "未命名角色")
        summary = character_state_summary(payload)
        conflicts.append({
            "candidate_id": row["id"],
            "conflict_type": "pending_character_state",
            "severity": "warning",
            "character_name": character_name,
            "source_file_path": source_path,
            "chapter_index": source_chapter,
            "summary": summary,
            "evidence": _stringify_state_value(payload.get("evidence"))[:500],
            "suggestion": "建议先确认上一章角色状态候选，再写下一章，避免人物状态承接错误。",
        })
    return conflicts[:12]


async def list_character_state_history(db, project_id: str, character_id: str, limit: int = 50) -> list[dict[str, Any]]:
    rows = await db.execute_fetchall(
        """SELECT id, character_id, character_name, source_file_path, chapter_index, state_summary,
                  location, goal, emotion, health, abilities, relationships, evidence, confidence, created_at
           FROM character_state_history
           WHERE project_id = ? AND character_id = ?
           ORDER BY COALESCE(chapter_index, 0) DESC, created_at DESC
           LIMIT ?""",
        (project_id, character_id, limit),
    )
    return [dict(row) for row in rows]


async def _merge_character_profile_state(
    db,
    project_id: str,
    character_id: str,
    payload: dict[str, Any],
    derived: dict[str, Any],
    now: int,
) -> None:
    rows = await db.execute_fetchall(
        "SELECT profile_data FROM character_profiles WHERE project_id = ? AND id = ? LIMIT 1",
        (project_id, character_id),
    )
    existing = _try_json_object(rows[0]["profile_data"] if rows else "{}")
    merged = dict(existing)
    for key in STATE_PROFILE_FIELDS:
        value = payload.get(key)
        if value:
            merged[key] = value
    for key, value in derived.items():
        if value is not None and value != "":
            merged[key] = value
    await db.execute(
        "UPDATE character_profiles SET profile_data = ?, last_modified = ? WHERE project_id = ? AND id = ?",
        (json.dumps(merged, ensure_ascii=False), now, project_id, character_id),
    )


def _try_json_object(text: str) -> dict[str, Any]:
    try:
        value = json.loads(text or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}
    return value if isinstance(value, dict) else {}


def _stringify_state_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def _float_or_none(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
