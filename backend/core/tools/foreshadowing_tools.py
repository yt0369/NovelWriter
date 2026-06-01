import time
import uuid

from models.tools import ToolDefinition, ToolFunction, ToolCall, ToolResult, ToolResultStatus
from db.database import get_db


def get_foreshadowing_tool_definitions() -> list[ToolDefinition]:
    return [
        ToolDefinition(function=ToolFunction(
            name="create_foreshadow",
            description="创建伏笔",
            parameters={"type": "object", "properties": {
                "name": {"type": "string", "description": "伏笔名称"},
                "description": {"type": "string", "description": "伏笔描述（可选）"},
                "plant_chapter_id": {"type": "string", "description": "埋设章节ID（可选）"},
                "resolve_chapter_id": {"type": "string", "description": "回收章节ID（可选）"},
                "status": {"type": "string", "description": "状态：planted/developing/resolved/expired（可选）"},
            }, "required": ["name"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="update_foreshadow_status",
            description="更新伏笔状态",
            parameters={"type": "object", "properties": {
                "foreshadow_id": {"type": "string", "description": "伏笔ID"},
                "status": {"type": "string", "description": "新状态：planted/developing/resolved/expired"},
            }, "required": ["foreshadow_id", "status"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="list_foreshadows",
            description="查询伏笔列表",
            parameters={"type": "object", "properties": {
                "status": {"type": "string", "description": "按状态筛选（可选）"},
            }, "required": []},
        )),
        ToolDefinition(function=ToolFunction(
            name="check_unresolved_foreshadows",
            description="检查未回收的伏笔，标记逾期警告",
            parameters={"type": "object", "properties": {}, "required": []},
        )),
    ]


async def execute_foreshadowing_tool(tool_call: ToolCall, project_id: str) -> ToolResult:
    name = tool_call.name
    args = tool_call.arguments

    try:
        db = await get_db(project_id)

        if name == "create_foreshadow":
            fs_id = str(uuid.uuid4())[:8]
            now = int(time.time())
            status = args.get("status", "planted")
            await db.execute(
                "INSERT INTO foreshadowing (id, project_id, name, description, plant_chapter_id, resolve_chapter_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (fs_id, project_id, args["name"], args.get("description"), args.get("plant_chapter_id"), args.get("resolve_chapter_id"), status, now),
            )
            await db.commit()
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"id": fs_id, "name": args["name"], "status": status})

        elif name == "update_foreshadow_status":
            foreshadow_id = args["foreshadow_id"]
            new_status = args["status"]
            valid_statuses = {"planted", "developing", "resolved", "expired"}
            if new_status not in valid_statuses:
                await db.close()
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"无效状态: {new_status}，有效值: {', '.join(valid_statuses)}")
            await db.execute(
                "UPDATE foreshadowing SET status = ? WHERE id = ? AND project_id = ?",
                (new_status, foreshadow_id, project_id),
            )
            await db.commit()
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"id": foreshadow_id, "status": new_status})

        elif name == "list_foreshadows":
            conditions = ["project_id = ?"]
            params: list = [project_id]
            if "status" in args and args["status"] is not None:
                conditions.append("status = ?")
                params.append(args["status"])
            where = " AND ".join(conditions)
            rows = await db.execute_fetchall(f"SELECT * FROM foreshadowing WHERE {where} ORDER BY created_at", params)
            foreshadows = [dict(r) for r in rows]
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"foreshadows": foreshadows})

        elif name == "check_unresolved_foreshadows":
            rows = await db.execute_fetchall(
                "SELECT * FROM foreshadowing WHERE project_id = ? AND status IN ('planted', 'developing')",
                (project_id,),
            )
            chapter_rows = await db.execute_fetchall(
                "SELECT id, sort_order FROM timeline_chapters WHERE project_id = ? ORDER BY sort_order",
                (project_id,),
            )
            chapter_order = {r["id"]: r["sort_order"] for r in chapter_rows}
            total_chapters = len(chapter_order)
            unresolved = []
            for r in rows:
                item = dict(r)
                item["overdue_warning"] = False
                if item.get("resolve_chapter_id") and item["resolve_chapter_id"] in chapter_order:
                    resolve_sort = chapter_order[item["resolve_chapter_id"]]
                    current_max = max(chapter_order.values()) if chapter_order else 0
                    if current_max > resolve_sort:
                        item["overdue_warning"] = True
                unresolved.append(item)
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"unresolved_foreshadows": unresolved, "total_chapters": total_chapters})

        else:
            await db.close()
            return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"未知工具: {name}")

    except Exception as e:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=str(e))
