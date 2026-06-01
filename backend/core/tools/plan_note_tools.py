"""
计划笔记工具：Agent 可创建结构化计划供用户审批。
对标 NovelIDE 的 PlanNoteViewer。
"""
import json
import time
import uuid

from models.tools import ToolDefinition, ToolFunction, ToolCall, ToolResult, ToolResultStatus
from db.database import get_db


def get_tool_definitions() -> list[ToolDefinition]:
    return [
        ToolDefinition(function=ToolFunction(
            name="manage_plan_note",
            description="管理计划笔记。创建结构化计划，用户可审批或要求修改。",
            parameters={
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create", "add_line", "annotate", "get", "approve", "reject"],
                        "description": "操作类型",
                    },
                    "title": {"type": "string", "description": "计划标题（create 时使用）"},
                    "text": {"type": "string", "description": "行内容（add_line 时使用）"},
                    "line_id": {"type": "string", "description": "行 ID（annotate 时使用）"},
                    "annotation": {"type": "string", "description": "注释内容（annotate 时使用）"},
                    "feedback": {"type": "string", "description": "修改意见（reject 时使用）"},
                },
                "required": ["action"],
            },
        )),
    ]


async def execute(tool_call: ToolCall, project_id: str) -> ToolResult:
    args = tool_call.arguments
    action = args.get("action", "")

    if action == "create":
        title = args.get("title", "执行计划")
        return await _create_plan(project_id, title)
    elif action == "add_line":
        text = args.get("text", "")
        return await _add_line(project_id, text)
    elif action == "annotate":
        line_id = args.get("line_id", "")
        annotation = args.get("annotation", "")
        return await _annotate(project_id, line_id, annotation)
    elif action == "get":
        return await _get_plan(project_id)
    elif action == "approve":
        return await _approve_plan(project_id)
    elif action == "reject":
        feedback = args.get("feedback", "")
        return await _reject_plan(project_id, feedback)
    else:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name="manage_plan_note", error=f"未知操作: {action}")


async def _create_plan(project_id: str, title: str) -> ToolResult:
    db = await get_db(project_id)
    try:
        plan_id = str(uuid.uuid4())[:12]
        now = int(time.time())
        await db.execute(
            "INSERT INTO plan_notes (id, project_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?)",
            (plan_id, project_id, title, now, now),
        )
        await db.commit()
        return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="manage_plan_note", result={"plan_id": plan_id, "status": "draft"})
    finally:
        await db.close()


async def _add_line(project_id: str, text: str) -> ToolResult:
    if not text:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name="manage_plan_note", error="text 不能为空")

    db = await get_db(project_id)
    try:
        # 找到当前项目的最新 draft 计划
        rows = await db.execute_fetchall(
            "SELECT id FROM plan_notes WHERE project_id = ? AND status = 'draft' ORDER BY created_at DESC LIMIT 1",
            (project_id,),
        )
        if not rows:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name="manage_plan_note", error="没有活跃的计划，请先 create")

        plan_id = rows[0]["id"]

        # 获取当前最大 order_index
        max_rows = await db.execute_fetchall(
            "SELECT COALESCE(MAX(order_index), -1) as max_order FROM plan_note_lines WHERE plan_id = ?",
            (plan_id,),
        )
        next_order = (max_rows[0]["max_order"] if max_rows else -1) + 1

        line_id = str(uuid.uuid4())[:8]
        await db.execute(
            "INSERT INTO plan_note_lines (id, plan_id, text, order_index) VALUES (?, ?, ?, ?)",
            (line_id, plan_id, text, next_order),
        )
        await db.commit()
        return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="manage_plan_note", result={"line_id": line_id, "order": next_order})
    finally:
        await db.close()


async def _annotate(project_id: str, line_id: str, annotation: str) -> ToolResult:
    if not line_id or not annotation:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name="manage_plan_note", error="line_id 和 annotation 不能为空")

    db = await get_db(project_id)
    try:
        annotation_id = str(uuid.uuid4())[:8]
        now = int(time.time())
        await db.execute(
            "INSERT INTO plan_note_annotations (id, plan_id, line_id, content, created_at, updated_at) VALUES (?, (SELECT plan_id FROM plan_note_lines WHERE id = ?), ?, ?, ?, ?)",
            (annotation_id, line_id, line_id, annotation, now, now),
        )
        await db.commit()
        return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="manage_plan_note", result={"annotation_id": annotation_id})
    finally:
        await db.close()


async def _get_plan(project_id: str) -> ToolResult:
    db = await get_db(project_id)
    try:
        rows = await db.execute_fetchall(
            "SELECT * FROM plan_notes WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
            (project_id,),
        )
        if not rows:
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="manage_plan_note", result={"plan": None})

        plan = dict(rows[0])
        plan_id = plan["id"]

        lines = await db.execute_fetchall(
            "SELECT * FROM plan_note_lines WHERE plan_id = ? ORDER BY order_index",
            (plan_id,),
        )
        plan["lines"] = [dict(l) for l in lines]

        annotations = await db.execute_fetchall(
            "SELECT * FROM plan_note_annotations WHERE plan_id = ?",
            (plan_id,),
        )
        plan["annotations"] = [dict(a) for a in annotations]

        return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="manage_plan_note", result={"plan": plan})
    finally:
        await db.close()


async def _approve_plan(project_id: str) -> ToolResult:
    db = await get_db(project_id)
    try:
        rows = await db.execute_fetchall(
            "SELECT id FROM plan_notes WHERE project_id = ? AND status = 'draft' ORDER BY created_at DESC LIMIT 1",
            (project_id,),
        )
        if not rows:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name="manage_plan_note", error="没有待审批的计划")

        plan_id = rows[0]["id"]
        now = int(time.time())
        await db.execute(
            "UPDATE plan_notes SET status = 'approved', updated_at = ? WHERE id = ?",
            (now, plan_id),
        )
        await db.commit()
        return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="manage_plan_note", result={"plan_id": plan_id, "status": "approved", "message": "用户已批准当前Plan，Agent可以开始执行。"})
    finally:
        await db.close()


async def _reject_plan(project_id: str, feedback: str) -> ToolResult:
    db = await get_db(project_id)
    try:
        rows = await db.execute_fetchall(
            "SELECT id FROM plan_notes WHERE project_id = ? AND status = 'draft' ORDER BY created_at DESC LIMIT 1",
            (project_id,),
        )
        if not rows:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name="manage_plan_note", error="没有待审批的计划")

        plan_id = rows[0]["id"]
        now = int(time.time())
        await db.execute(
            "UPDATE plan_notes SET status = 'rejected', updated_at = ? WHERE id = ?",
            (now, plan_id),
        )
        await db.commit()
        return ToolResult(
            status=ToolResultStatus.EXECUTED,
            tool_name="manage_plan_note",
            result={"plan_id": plan_id, "status": "rejected", "message": f"用户对当前Plan提出以下修改意见：\n\n{feedback}"},
        )
    finally:
        await db.close()
