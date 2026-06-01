"""任务列表工具：Agent 可管理待办任务。"""
import time
import uuid

from db.database import get_db
from models.tools import ToolDefinition, ToolFunction, ToolCall, ToolResult, ToolResultStatus


def _row_to_todo(row) -> dict:
    item = dict(row)
    item["done"] = bool(item.get("done"))
    return item


async def _list_todos(project_id: str) -> list[dict]:
    db = await get_db(project_id)
    try:
        rows = await db.execute_fetchall(
            "SELECT id, text, done, priority, created_at, updated_at FROM todo_items WHERE project_id = ? ORDER BY done, created_at",
            (project_id,),
        )
        return [_row_to_todo(r) for r in rows]
    finally:
        await db.close()


def get_tool_definitions() -> list[ToolDefinition]:
    return [
        ToolDefinition(function=ToolFunction(
            name="manageTodos",
            description="管理待办任务列表。支持添加、更新、删除、列出任务。",
            parameters={
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["add", "update", "remove", "complete", "list"],
                        "description": "操作类型",
                    },
                    "id": {"type": "string", "description": "任务 ID（update/remove 时必填）"},
                    "text": {"type": "string", "description": "任务描述（add/update 时使用）"},
                    "done": {"type": "boolean", "description": "是否完成（update 时使用）"},
                    "priority": {
                        "type": "string",
                        "enum": ["high", "normal", "low"],
                        "description": "优先级（add 时使用）",
                    },
                },
                "required": ["action"],
            },
        )),
    ]


async def execute(tool_call: ToolCall, project_id: str) -> ToolResult:
    args = tool_call.arguments
    action = args.get("action", "list")
    now = int(time.time() * 1000)

    if action == "add":
        todo = {
            "id": str(uuid.uuid4())[:8],
            "text": (args.get("text") or "").strip(),
            "done": False,
            "priority": args.get("priority", "normal"),
        }
        if not todo["text"]:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name="manageTodos", error="text 不能为空")
        db = await get_db(project_id)
        try:
            await db.execute(
                "INSERT INTO todo_items (id, project_id, text, done, priority, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)",
                (todo["id"], project_id, todo["text"], todo["priority"], now, now),
            )
            await db.commit()
        finally:
            await db.close()
        return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="manageTodos", result={"todo": todo, "todos": await _list_todos(project_id)})

    elif action in {"update", "complete"}:
        todo_id = args.get("id")
        if not todo_id:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name="manageTodos", error="update/complete 需要 id")
        updates = []
        params = []
        if "text" in args:
            updates.append("text = ?")
            params.append(args["text"])
        if "priority" in args:
            updates.append("priority = ?")
            params.append(args["priority"])
        if "done" in args or action == "complete":
            updates.append("done = ?")
            params.append(1 if args.get("done", True) else 0)
        if not updates:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name="manageTodos", error="没有可更新字段")
        updates.append("updated_at = ?")
        params.append(now)
        params.extend([project_id, todo_id])
        db = await get_db(project_id)
        try:
            cur = await db.execute(
                f"UPDATE todo_items SET {', '.join(updates)} WHERE project_id = ? AND id = ?",
                params,
            )
            await db.commit()
            if cur.rowcount == 0:
                return ToolResult(status=ToolResultStatus.ERROR, tool_name="manageTodos", error=f"任务 {todo_id} 不存在")
        finally:
            await db.close()
        return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="manageTodos", result={"id": todo_id, "todos": await _list_todos(project_id)})

    elif action == "remove":
        todo_id = args.get("id")
        if not todo_id:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name="manageTodos", error="remove 需要 id")
        db = await get_db(project_id)
        try:
            cur = await db.execute(
                "DELETE FROM todo_items WHERE project_id = ? AND id = ?",
                (project_id, todo_id),
            )
            await db.commit()
            removed = cur.rowcount
        finally:
            await db.close()
        return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="manageTodos", result={"removed": removed, "todos": await _list_todos(project_id)})

    elif action == "list":
        return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="manageTodos", result={"todos": await _list_todos(project_id)})

    return ToolResult(status=ToolResultStatus.ERROR, tool_name="manageTodos", error=f"未知操作: {action}")
