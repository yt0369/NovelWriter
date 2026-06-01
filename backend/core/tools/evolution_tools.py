"""
自进化记忆 AI 工具 — agent 跨项目持久化记忆、技能进化、会话摘要

工具：
  manage_evolution  — 写入动作（record_insight / record_pattern / record_correction /
                       create_skill / optimize_skill / summarize_session）
  query_evolution   — 读取动作（recall / list）
"""

import uuid
import time
import json
from typing import Any

from models.tools import ToolDefinition, ToolFunction, ToolCall, ToolResult, ToolResultStatus


# ─── 工具定义 ─────────────────────────────────────────────

def get_evolution_tool_definitions() -> list[ToolDefinition]:
    return [
        ToolDefinition(function=ToolFunction(
            name="query_evolution",
            description="""【查询自进化记忆】搜索或列出 agent 的跨项目持久记忆。

## 记忆类型
- **insight**: 任务完成后总结的洞察（如「悬疑小说开场需在 500 字内设钩子」）
- **pattern**: 最佳工作范式（如「角色档案先初始化再写正文效率更高」）
- **correction**: 被用户纠正的内容（如「用户不喜欢用第二人称叙述」）
- **workflow**: 工作流程经验（如「先大纲后章节的节奏」）
- **preference**: 用户偏好（如「对话描写要自然，避免书面语」）

## 查询方式
1. **recall**: 按关键词搜索记忆（匹配 content / context）
2. **list**: 按类型或重要程度过滤列出

## 使用场景
- 开始新项目时，recall 相关记忆避免重复犯错
- 写作前查看相关 preference 和 correction
- 技能创建前查看已有的 insight 和 pattern""",
            parameters={"type": "object", "properties": {
                "action": {"type": "string", "enum": ["recall", "list"], "description": "recall=关键词搜索, list=按条件列出"},
                "query": {"type": "string", "description": "搜索关键词（recall 时必填，匹配 content 和 context）"},
                "type": {"type": "string", "enum": ["insight", "pattern", "correction", "workflow", "preference"], "description": "按记忆类型过滤"},
                "importance": {"type": "string", "enum": ["low", "medium", "high", "critical"], "description": "按重要程度过滤"},
                "limit": {"type": "number", "description": "返回数量上限（默认 20，最大 50）"},
            }, "required": ["action"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="manage_evolution",
            description="""【管理自进化记忆】记录洞察、工作范式、被纠正内容，或从积累的经验中创建/优化技能。

## ⚠️ 自进化铁律
- 记忆是跨项目持久的，不要记录项目特定的临时信息
- 只记录**真正有价值的经验**，不要记录琐碎细节
- correction 必须如实记录用户的原始反馈，不要改写

## 写入动作

### record_insight（记录洞察）
任务完成后主动调用。记录从任务中学到的通用经验。
示例：「长篇对话需要每 5 轮插入动作描写保持节奏」

### record_pattern（记录最佳范式）
发现高效的工作流程时记录。
示例：「先创建时间线事件再写章节草稿，一致性更好」

### record_correction（记录纠正）
被用户纠正时必须调用。原文记录用户反馈。
示例：「用户说：不要在叙事中混入作者评论」

### create_skill（创建技能）
当同一类 insight/pattern 积累 3 条以上时，可固化为正式技能文件。

### optimize_skill（优化技能）
基于使用经验，分析现有技能的不足并建议改进。

### summarize_session（会话摘要）
会话结束时生成摘要，用于下次开新会话时保持上下文连续性。""",
            parameters={"type": "object", "properties": {
                "action": {"type": "string", "enum": ["record_insight", "record_pattern", "record_correction", "create_skill", "optimize_skill", "summarize_session"], "description": "要执行的动作"},
                "content": {"type": "string", "description": "记忆内容（record_* 时必填）。简洁明确的一句话。"},
                "context": {"type": "string", "description": "触发上下文：用户说了什么 / 做了什么 / 什么任务场景"},
                "memory_type": {"type": "string", "enum": ["insight", "pattern", "correction", "workflow", "preference"], "description": "记忆类型（record_* 时使用，默认跟随 action）"},
                "importance": {"type": "string", "enum": ["low", "medium", "high", "critical"], "description": "重要程度（默认 medium）"},
                "related_skills": {"type": "array", "items": {"type": "string"}, "description": "关联的技能名称列表"},
                "skill_name": {"type": "string", "description": "技能名称（create_skill 时必填）"},
                "skill_category": {"type": "string", "description": "技能分类（create_skill 时必填：创作/规划/设计/审核/补丁）"},
                "skill_description": {"type": "string", "description": "技能描述（create_skill 时必填）"},
                "target_skill_name": {"type": "string", "description": "要优化的技能名称（optimize_skill 时必填）"},
                "session_id": {"type": "string", "description": "会话 ID（summarize_session 时必填）"},
                "project_id": {"type": "string", "description": "项目 ID（summarize_session 时必填）"},
                "summary": {"type": "string", "description": "会话摘要（summarize_session 时必填）"},
                "key_decisions": {"type": "array", "items": {"type": "string"}, "description": "关键决策列表"},
                "unresolved_topics": {"type": "array", "items": {"type": "string"}, "description": "未完成的话题列表"},
            }, "required": ["action"]},
        )),
    ]


# ─── 执行函数 ─────────────────────────────────────────────

async def execute_evolution_tool(tool_call: ToolCall, project_id: str) -> ToolResult:
    name = tool_call.name
    args = tool_call.arguments if isinstance(tool_call.arguments, dict) else {}

    if name == "query_evolution":
        return await _execute_query(args, project_id)
    elif name == "manage_evolution":
        return await _execute_manage(args, project_id)
    else:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"未知工具: {name}")


async def _execute_query(args: dict, project_id: str) -> ToolResult:
    from db.database import get_project_db

    action = args.get("action", "list")
    limit = min(args.get("limit", 20), 50)
    mem_type = args.get("type")
    importance = args.get("importance")

    try:
        if action == "recall":
            query = args.get("query", "").strip()
            if not query:
                return ToolResult(status=ToolResultStatus.ERROR, tool_name="query_evolution", error="recall 需要提供 query 参数")

            async def _recall():
                async with get_project_db(project_id) as db:
                    sql = "SELECT * FROM agent_memories WHERE (content LIKE ? OR context LIKE ?)"
                    params: list[Any] = [f"%{query}%", f"%{query}%"]
                    if mem_type:
                        sql += " AND type = ?"
                        params.append(mem_type)
                    if importance:
                        sql += " AND importance = ?"
                        params.append(importance)
                    sql += " ORDER BY accessed_at DESC LIMIT ?"
                    params.append(limit)
                    rows = await db.execute_fetchall(sql, params)
                    return [dict(r) for r in rows]

            results = await _recall()

            if not results:
                return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="query_evolution", result={
                    "success": True, "count": 0, "results": [],
                    "hint": f"未找到与「{query}」相关的记忆",
                })

            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="query_evolution", result={
                "success": True, "count": len(results),
                "results": [_format_entry(r) for r in results],
            })

        elif action == "list":
            async def _list():
                async with get_project_db(project_id) as db:
                    sql = "SELECT * FROM agent_memories WHERE 1=1"
                    params: list[Any] = []
                    if mem_type:
                        sql += " AND type = ?"
                        params.append(mem_type)
                    if importance:
                        sql += " AND importance = ?"
                        params.append(importance)
                    sql += " ORDER BY accessed_at DESC LIMIT ?"
                    params.append(limit)
                    rows = await db.execute_fetchall(sql, params)

                    # 统计
                    stats_rows = await db.execute_fetchall(
                        "SELECT type, COUNT(*) as cnt FROM agent_memories GROUP BY type"
                    )
                    stats = {r["type"]: r["cnt"] for r in stats_rows}
                    total_row = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM agent_memories")
                    total = total_row[0]["cnt"] if total_row else 0

                    return [dict(r) for r in rows], stats, total

            results, stats, total = await _list()

            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="query_evolution", result={
                "success": True, "count": len(results),
                "results": [_format_entry(r) for r in results],
                "stats": {"totalMemories": total, "byType": stats},
            })

        else:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name="query_evolution", error=f"未知查询动作: {action}")

    except Exception as e:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name="query_evolution", error=str(e))


async def _execute_manage(args: dict, project_id: str) -> ToolResult:
    from db.database import get_project_db

    action = args.get("action", "")
    now_ms = int(time.time() * 1000)

    try:
        if action in ("record_insight", "record_pattern", "record_correction"):
            return await _record_memory(args, action, project_id, now_ms)
        elif action == "create_skill":
            return await _create_skill(args, project_id, now_ms)
        elif action == "optimize_skill":
            return await _optimize_skill(args, project_id)
        elif action == "summarize_session":
            return await _summarize_session(args, project_id, now_ms)
        else:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name="manage_evolution", error=f"未知动作: {action}")
    except Exception as e:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name="manage_evolution", error=str(e))


async def _record_memory(args: dict, action: str, project_id: str, now_ms: int) -> ToolResult:
    from db.database import get_project_db

    content = (args.get("content") or "").strip()
    if not content:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name="manage_evolution", error="content 不能为空")

    type_map = {
        "record_insight": "insight",
        "record_pattern": "pattern",
        "record_correction": "correction",
    }
    mem_type = args.get("memory_type") or type_map.get(action, "insight")
    importance = args.get("importance") or ("high" if action == "record_correction" else "medium")
    context = (args.get("context") or "").strip()
    related_skills = json.dumps(args.get("related_skills", []), ensure_ascii=False)

    async with get_project_db(project_id) as db:
        # 检查重复
        existing = await db.execute_fetchall(
            "SELECT id FROM agent_memories WHERE type = ? AND LOWER(TRIM(content)) = LOWER(TRIM(?))",
            [mem_type, content],
        )
        if existing:
            dup_id = existing[0]["id"]
            await db.execute(
                "UPDATE agent_memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?",
                [now_ms, dup_id],
            )
            await db.commit()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="manage_evolution", result={
                "success": True, "message": f"该经验已记录过（ID: {dup_id}），已更新访问信息",
                "id": dup_id, "duplicate": True,
            })

        entry_id = f"mem-{uuid.uuid4().hex[:12]}"
        await db.execute(
            "INSERT INTO agent_memories (id, project_id, type, content, context, importance, related_skills, access_count, created_at, accessed_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
            [entry_id, project_id, mem_type, content, context, importance, related_skills, now_ms, now_ms],
        )
        await db.commit()

    action_labels = {"record_insight": "洞察", "record_pattern": "工作范式", "record_correction": "纠正记录"}
    return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="manage_evolution", result={
        "success": True, "message": f"{action_labels.get(action, '记忆')}已记录",
        "id": entry_id, "type": mem_type, "importance": importance,
    })


async def _create_skill(args: dict, project_id: str, now_ms: int) -> ToolResult:
    from db.database import get_project_db

    skill_name = (args.get("skill_name") or "").strip()
    skill_category = (args.get("skill_category") or "").strip()
    skill_description = (args.get("skill_description") or "").strip()

    if not skill_name:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name="manage_evolution", error="skill_name 不能为空")
    if not skill_category:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name="manage_evolution", error="skill_category 不能为空")
    if not skill_description:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name="manage_evolution", error="skill_description 不能为空")

    async with get_project_db(project_id) as db:
        # 搜索相关记忆
        keywords = [skill_name, skill_description] + [w for w in skill_description.split() if len(w) >= 2]
        source_memories = []
        for kw in keywords:
            rows = await db.execute_fetchall(
                "SELECT * FROM agent_memories WHERE (type = 'insight' OR type = 'pattern') AND (content LIKE ? OR context LIKE ?) ORDER BY accessed_at DESC LIMIT 10",
                [f"%{kw}%", f"%{kw}%"],
            )
            for r in rows:
                r_dict = dict(r)
                if r_dict["id"] not in [m["id"] for m in source_memories]:
                    source_memories.append(r_dict)

        source_memories = source_memories[:10]

        if not source_memories:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name="manage_evolution", error="未找到相关的 insight/pattern 记忆来生成技能。请先积累足够的经验记录。")

        # 更新访问时间
        for m in source_memories:
            await db.execute(
                "UPDATE agent_memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?",
                [now_ms, m["id"]],
            )
        await db.commit()

    # 生成技能内容
    skill_content = _generate_skill_content(skill_name, skill_description, skill_category, source_memories)

    return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="manage_evolution", result={
        "success": True,
        "message": f"技能「{skill_name}」的内容模板已生成",
        "skill": {
            "name": skill_name,
            "category": skill_category,
            "description": skill_description,
            "sourceMemoryCount": len(source_memories),
            "sourceMemoryIds": [m["id"] for m in source_memories],
            "content": skill_content,
        },
        "hint": "此技能内容需要通过 write_file 工具写入到技能配置目录下才能生效",
    })


async def _optimize_skill(args: dict, project_id: str) -> ToolResult:
    from db.database import get_project_db

    target_skill_name = (args.get("target_skill_name") or "").strip()
    if not target_skill_name:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name="manage_evolution", error="target_skill_name 不能为空")

    async with get_project_db(project_id) as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM agent_memories WHERE content LIKE ? OR context LIKE ? ORDER BY accessed_at DESC LIMIT 20",
            [f"%{target_skill_name}%", f"%{target_skill_name}%"],
        )
        related = [dict(r) for r in rows]

    corrections = [m for m in related if m["type"] == "correction"]
    insights = [m for m in related if m["type"] in ("insight", "pattern")]

    if not corrections and not insights:
        return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="manage_evolution", result={
            "success": True,
            "message": f"未找到与「{target_skill_name}」相关的改进经验",
            "hint": "建议先通过 record_correction 或 record_insight 记录使用该技能时发现的问题",
        })

    suggestions = []
    for c in corrections:
        suggestions.append(f"[纠正] {c['content']}（场景：{c.get('context', '未知')}）")
    for i in insights:
        label = "[新洞察]" if i["type"] == "insight" else "[新范式]"
        suggestions.append(f"{label} {i['content']}")

    return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="manage_evolution", result={
        "success": True,
        "message": f"已基于 {len(corrections)} 条纠正和 {len(insights)} 条洞察生成优化建议",
        "optimization": {
            "skillName": target_skill_name,
            "corrections": [{"content": c["content"], "context": c.get("context", ""), "id": c["id"]} for c in corrections],
            "suggestions": suggestions,
            "newInsights": [{"content": i["content"], "id": i["id"]} for i in insights],
        },
        "hint": "请根据建议修改对应的技能文件",
    })


async def _summarize_session(args: dict, project_id: str, now_ms: int) -> ToolResult:
    session_id = (args.get("session_id") or "").strip()
    summary = (args.get("summary") or "").strip()

    if not session_id:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name="manage_evolution", error="session_id 不能为空")
    if not summary:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name="manage_evolution", error="summary 不能为空")

    # 会话摘要存储为特殊类型的记忆
    content = f"[会话摘要] {summary}"
    key_decisions = args.get("key_decisions", [])
    unresolved = args.get("unresolved_topics", [])
    context_parts = []
    if key_decisions:
        context_parts.append(f"关键决策: {', '.join(key_decisions)}")
    if unresolved:
        context_parts.append(f"未完成: {', '.join(unresolved)}")
    context = " | ".join(context_parts)

    mem_args = {
        "content": content,
        "context": context,
        "memory_type": "workflow",
        "importance": "medium",
    }
    result = await _record_memory(mem_args, "record_pattern", project_id, now_ms)

    return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="manage_evolution", result={
        "success": True,
        "message": "会话摘要已保存",
        "sessionId": session_id,
    })


# ─── 辅助函数 ─────────────────────────────────────────────

def _format_entry(entry: dict) -> dict:
    return {
        "id": entry.get("id"),
        "type": entry.get("type"),
        "content": entry.get("content"),
        "context": entry.get("context"),
        "importance": entry.get("importance"),
        "relatedSkills": json.loads(entry["related_skills"]) if entry.get("related_skills") else None,
        "createdAt": entry.get("created_at"),
        "accessedAt": entry.get("accessed_at"),
        "accessCount": entry.get("access_count"),
    }


def _generate_skill_content(name: str, description: str, category: str, sources: list[dict]) -> str:
    lines = [
        "---",
        f"name: {name}",
        f"description: {description}",
        f"tags: [技能, {category}]",
        "auto_evolved: true",
        "---",
        "",
        f"# {name}",
        "",
        f"> {description}",
        "",
        "## 方法论",
        "",
    ]

    insights = [s for s in sources if s["type"] == "insight"]
    if insights:
        lines.append("### 核心洞察")
        lines.append("")
        for i, insight in enumerate(insights, 1):
            lines.append(f"{i}. {insight['content']}")
            if insight.get("context"):
                lines.append(f"   - 场景：{insight['context']}")
        lines.append("")

    patterns = [s for s in sources if s["type"] == "pattern"]
    if patterns:
        lines.append("### 最佳实践")
        lines.append("")
        for i, pattern in enumerate(patterns, 1):
            lines.append(f"{i}. {pattern['content']}")
            if pattern.get("context"):
                lines.append(f"   - 适用场景：{pattern['context']}")
        lines.append("")

    lines.extend([
        "## 使用指南",
        "",
        "此技能由 agent 自进化系统自动生成。",
        "在使用过程中如有改进建议，请通过 manage_evolution(action=\"optimize_skill\") 反馈。",
        "",
    ])

    return "\n".join(lines)
