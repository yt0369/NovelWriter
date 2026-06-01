"""
4层记忆栈管理：
- L0: 工作记忆（当前对话上下文，由engine管理）
- L1: 短期记忆（当前会话的重要事实，衰减快）
- L2: 长期记忆（持久化知识图谱节点）
- L3: 情景记忆（章节摘要、剧情事件）

L1记忆存储在chat_messages的metadata中，标记为layer=l1。
L2记忆是knowledge_nodes中importance>=high的节点。
L3记忆是knowledge_nodes中wing=剧情且category含"章节摘要"的节点。
"""
import time
import json
import uuid
from db.database import get_db
from utils.token_estimator import estimate_tokens


L1_DECAY_TTL = 3600
L1_PROMOTE_THRESHOLD = 3

WING_KEYWORDS = {
    "世界": ["世界观", "世界", "设定", "魔法", "体系", "力量", "地理", "种族", "国家", "城市", "大陆", "规则", "法则"],
    "角色": ["角色", "人物", "主角", "配角", "反派", "性格", "外貌", "背景", "关系", "师徒", "恋人", "敌人"],
    "剧情": ["剧情", "故事", "大纲", "章节", "事件", "冲突", "高潮", "结局", "伏笔", "悬念", "转折"],
    "灵感": ["灵感", "想法", "创意", "点子", "如果", "假如", "设想"],
    "物品": ["物品", "武器", "道具", "装备", "宝物", "法宝"],
    "设定": ["设定", "规则", "制度", "组织", "门派", "家族"],
}


async def add_l1_memory(project_id: str, session_id: str, content: str, tags: list[str] | None = None):
    """添加L1短期记忆（写入chat_messages metadata）。"""
    db = await get_db(project_id)
    try:
        now = int(time.time())
        metadata = json.dumps({
            "layer": "l1",
            "tags": tags or [],
            "created_at": now,
            "referenced_count": 0,
        })
        await db.execute(
            "INSERT INTO chat_messages (id, session_id, role, content, metadata, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            (f"l1-{uuid.uuid4().hex[:8]}", session_id, "system", f"[记忆] {content}", metadata, now),
        )
        await db.commit()
    finally:
        await db.close()


async def query_l1_memories(project_id: str, session_id: str, limit: int = 5) -> list[dict]:
    """查询当前会话的L1记忆。"""
    db = await get_db(project_id)
    try:
        cursor = await db.execute(
            "SELECT content, metadata FROM chat_messages WHERE session_id = ? AND role = 'system' AND metadata LIKE ? ORDER BY timestamp DESC LIMIT ?",
            (session_id, '%"layer": "l1"%', limit),
        )
        rows = await cursor.fetchall()
        results = []
        for row in rows:
            try:
                meta = json.loads(row["metadata"])
                if meta.get("layer") == "l1":
                    results.append({
                        "content": row["content"],
                        "tags": meta.get("tags", []),
                        "created_at": meta.get("created_at"),
                    })
            except (json.JSONDecodeError, TypeError):
                continue
        return results
    finally:
        await db.close()


async def promote_l1_to_l2(project_id: str, session_id: str, content: str, name: str, wing: str = "灵感"):
    """将L1记忆提升为L2长期记忆（创建知识图谱节点）。"""
    from core.memory.graph import create_node
    db = await get_db(project_id)
    try:
        await create_node(
            db, project_id,
            name=name,
            wing=wing,
            summary=content[:500],
            detail=content,
            importance="high",
            category="自动提升",
        )
    finally:
        await db.close()


def detect_topic_wing(user_message: str) -> str | None:
    for wing, keywords in WING_KEYWORDS.items():
        for kw in keywords:
            if kw in user_message:
                return wing
    return None


async def get_l2_context(project_id: str, wing: str) -> str:
    db = await get_db(project_id)
    try:
        cursor = await db.execute(
            "SELECT name, summary, detail FROM knowledge_nodes WHERE project_id = ? AND wing = ? AND importance IN ('high', 'critical') ORDER BY last_modified DESC",
            (project_id, wing),
        )
        rows = await cursor.fetchall()
        if not rows:
            return ""
        parts = []
        total_tokens = 0
        for row in rows:
            line = f"- {row['name']}: {row['summary']}"
            line_tokens = estimate_tokens(line)
            if total_tokens + line_tokens > 800:
                break
            parts.append(line)
            total_tokens += line_tokens
        if not parts:
            return ""
        return f"[{wing}翼知识]\n" + "\n".join(parts)
    finally:
        await db.close()


async def get_contextual_memories(project_id: str, session_id: str, query: str) -> str:
    parts = []

    db = await get_db(project_id)
    try:
        row = await db.execute_fetchall(
            "SELECT name, genre, target_chapters FROM projects WHERE id = ?",
            (project_id,),
        )
        if row:
            r = row[0]
            l0_parts = []
            if r["name"]:
                l0_parts.append(f"项目: {r['name']}")
            if r["genre"]:
                l0_parts.append(f"类型: {r['genre']}")
            if r["target_chapters"]:
                l0_parts.append(f"目标章数: {r['target_chapters']}")
            if l0_parts:
                parts.append("[项目信息]\n" + "\n".join(l0_parts))
    finally:
        await db.close()

    db = await get_db(project_id)
    try:
        cursor = await db.execute(
            "SELECT name, summary FROM knowledge_nodes WHERE project_id = ? AND importance = 'critical' ORDER BY last_modified DESC",
            (project_id,),
        )
        rows = await cursor.fetchall()
        if rows:
            l1_parts = []
            total_tokens = 0
            for row in rows:
                line = f"- {row['name']}: {row['summary']}"
                line_tokens = estimate_tokens(line)
                if total_tokens + line_tokens > 500:
                    break
                l1_parts.append(line)
                total_tokens += line_tokens
            if l1_parts:
                parts.append("[核心知识]\n" + "\n".join(l1_parts))
    finally:
        await db.close()

    wing = detect_topic_wing(query)
    if wing:
        l2_text = await get_l2_context(project_id, wing)
        if l2_text:
            parts.append(l2_text)

    # L3: 情景记忆 — 最近的章节摘要和剧情事件
    db = await get_db(project_id)
    try:
        # 查询最近的章节摘要（从知识图谱中）
        cursor = await db.execute(
            "SELECT name, summary FROM knowledge_nodes WHERE project_id = ? AND wing = '剧情' AND category LIKE '%章节%' ORDER BY last_modified DESC LIMIT 3",
            (project_id,),
        )
        rows = await cursor.fetchall()
        if rows:
            l3_parts = [f"- {row['name']}: {row['summary'][:200]}" for row in rows if row['summary']]
            if l3_parts:
                parts.append("[最近章节摘要]\n" + "\n".join(l3_parts))

        # 查询最近的剧情事件
        cursor = await db.execute(
            "SELECT name, summary FROM knowledge_nodes WHERE project_id = ? AND wing = '剧情' AND category LIKE '%事件%' ORDER BY last_modified DESC LIMIT 5",
            (project_id,),
        )
        rows = await cursor.fetchall()
        if rows:
            event_parts = [f"- {row['name']}: {row['summary'][:150]}" for row in rows if row['summary']]
            if event_parts:
                parts.append("[近期事件]\n" + "\n".join(event_parts))
    except Exception:
        pass
    finally:
        await db.close()

    # 跨项目进化记忆
    try:
        from core.memory.evolutionary import get_shared_context
        shared_db = await get_db(None)
        shared_context = await get_shared_context(shared_db, query)
        await shared_db.close()
        if shared_context:
            parts.append(shared_context)
    except Exception:
        pass

    return "\n\n".join(parts) if parts else ""


async def extract_conversation_knowledge(messages: list[dict], project_id: str, session_id: str) -> list[dict]:
    """从对话历史中提取知识，写入L1记忆。过滤read类结果，保留write类产出。"""
    extracted = []

    WRITE_TOOLS = {
        "write_file", "patch_file",
        "create_character", "update_character", "manage_relationships", "manage_sub_category",
        "create_outline_section", "update_outline_section",
        "create_event", "update_event",
        "create_foreshadow", "update_foreshadow_status",
        "manageTodos", "manage_memory", "manage_plan_note",
    }

    tool_call_map = {}
    for msg in messages:
        if msg.get("role") == "assistant" and msg.get("tool_calls"):
            for tc in msg["tool_calls"]:
                func = tc.get("function", {})
                tool_map_entry = {"name": func.get("name", ""), "arguments": {}}
                try:
                    import json as _json
                    tool_map_entry["arguments"] = _json.loads(func.get("arguments", "{}"))
                except Exception:
                    pass
                tool_call_map[tc.get("id", "")] = tool_map_entry

    for msg in messages:
        if msg.get("role") == "tool":
            tc_id = msg.get("tool_call_id", "")
            tc_info = tool_call_map.get(tc_id, {})
            tool_name = tc_info.get("name", "")

            if tool_name not in WRITE_TOOLS:
                continue

            content = msg.get("content", "")
            if not content or len(content) < 20:
                continue

            knowledge = f"[{tool_name}] {content[:300]}"
            tags = [tool_name]
            wing = detect_topic_wing(tc_info.get("arguments", {}).get("path", "") or content[:100])
            if wing:
                tags.append(wing)

            await add_l1_memory(project_id, session_id, knowledge, tags)
            extracted.append({"tool": tool_name, "summary": knowledge[:100]})

    # 提取用户偏好和约束
    for msg in messages:
        if msg.get("role") == "user":
            content = msg.get("content", "")
            from core.agent.compression import _extract_constraints
            constraints = _extract_constraints(content)
            if constraints:
                knowledge = f"[用户约束] {'; '.join(constraints[:3])}"
                await add_l1_memory(project_id, session_id, knowledge, ["用户约束"])
                extracted.append({"type": "constraint", "summary": knowledge[:100]})

    return extracted
