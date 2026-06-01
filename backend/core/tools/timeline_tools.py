import time
import uuid

from models.tools import ToolDefinition, ToolFunction, ToolCall, ToolResult, ToolResultStatus
from db.database import get_db


def get_timeline_tool_definitions() -> list[ToolDefinition]:
    return [
        ToolDefinition(function=ToolFunction(
            name="create_volume",
            description="创建时间线卷",
            parameters={"type": "object", "properties": {
                "name": {"type": "string", "description": "卷名称"},
                "description": {"type": "string", "description": "卷描述（可选）"},
                "sort_order": {"type": "integer", "description": "排序序号（可选）"},
            }, "required": ["name"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="create_chapter",
            description="创建时间线章节",
            parameters={"type": "object", "properties": {
                "volume_id": {"type": "string", "description": "所属卷ID（可选）"},
                "name": {"type": "string", "description": "章节名称"},
                "summary": {"type": "string", "description": "章节摘要（可选）"},
                "sort_order": {"type": "integer", "description": "排序序号（可选）"},
                "file_path": {"type": "string", "description": "关联文件路径（可选）"},
            }, "required": ["name"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="create_event",
            description="创建时间线事件",
            parameters={"type": "object", "properties": {
                "chapter_id": {"type": "string", "description": "所属章节ID（可选）"},
                "name": {"type": "string", "description": "事件名称"},
                "description": {"type": "string", "description": "事件描述（可选）"},
                "day": {"type": "integer", "description": "故事内天数（可选）"},
                "hour": {"type": "integer", "description": "故事内小时（可选）"},
                "story_line_id": {"type": "string", "description": "关联故事线ID（可选）"},
                "status": {"type": "string", "description": "事件状态（可选）"},
            }, "required": ["name"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="update_event",
            description="更新时间线事件",
            parameters={"type": "object", "properties": {
                "event_id": {"type": "string", "description": "事件ID"},
                "name": {"type": "string", "description": "事件名称（可选）"},
                "description": {"type": "string", "description": "事件描述（可选）"},
                "day": {"type": "integer", "description": "故事内天数（可选）"},
                "hour": {"type": "integer", "description": "故事内小时（可选）"},
                "status": {"type": "string", "description": "事件状态（可选）"},
            }, "required": ["event_id"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="list_events",
            description="查询时间线事件",
            parameters={"type": "object", "properties": {
                "chapter_id": {"type": "string", "description": "按章节ID筛选（可选）"},
                "story_line_id": {"type": "string", "description": "按故事线ID筛选（可选）"},
            }, "required": []},
        )),
        ToolDefinition(function=ToolFunction(
            name="create_storyline",
            description="创建故事线",
            parameters={"type": "object", "properties": {
                "name": {"type": "string", "description": "故事线名称"},
                "color": {"type": "string", "description": "标识颜色（可选）"},
                "is_main": {"type": "boolean", "description": "是否为主线（可选）"},
            }, "required": ["name"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="link_event_to_storyline",
            description="将事件关联到故事线",
            parameters={"type": "object", "properties": {
                "event_id": {"type": "string", "description": "事件ID"},
                "story_line_id": {"type": "string", "description": "故事线ID"},
            }, "required": ["event_id", "story_line_id"]},
        )),
    ]


async def execute_timeline_tool(tool_call: ToolCall, project_id: str) -> ToolResult:
    name = tool_call.name
    args = tool_call.arguments

    try:
        db = await get_db(project_id)

        if name == "create_volume":
            vol_id = str(uuid.uuid4())[:8]
            sort_order = args.get("sort_order", 0)
            await db.execute(
                "INSERT INTO timeline_volumes (id, project_id, name, description, sort_order) VALUES (?, ?, ?, ?, ?)",
                (vol_id, project_id, args["name"], args.get("description"), sort_order),
            )
            await db.commit()
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"id": vol_id, "name": args["name"]})

        elif name == "create_chapter":
            chap_id = str(uuid.uuid4())[:8]
            sort_order = args.get("sort_order", 0)
            await db.execute(
                "INSERT INTO timeline_chapters (id, volume_id, project_id, name, summary, sort_order, file_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (chap_id, args.get("volume_id"), project_id, args["name"], args.get("summary"), sort_order, args.get("file_path")),
            )
            await db.commit()
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"id": chap_id, "name": args["name"]})

        elif name == "create_event":
            evt_id = str(uuid.uuid4())[:8]
            now = int(time.time())
            await db.execute(
                "INSERT INTO timeline_events (id, chapter_id, project_id, name, description, day, hour, story_line_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (evt_id, args.get("chapter_id"), project_id, args["name"], args.get("description"), args.get("day"), args.get("hour"), args.get("story_line_id"), args.get("status", "planned"), now),
            )
            await db.commit()
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"id": evt_id, "name": args["name"]})

        elif name == "update_event":
            event_id = args["event_id"]
            updates = {}
            for key in ("name", "description", "day", "hour", "status"):
                if key in args and args[key] is not None:
                    updates[key] = args[key]
            if not updates:
                await db.close()
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="没有需要更新的字段")
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            values = list(updates.values()) + [event_id]
            await db.execute(f"UPDATE timeline_events SET {set_clause} WHERE id = ?", values)
            await db.commit()
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"id": event_id, "updated": list(updates.keys())})

        elif name == "list_events":
            conditions = ["project_id = ?"]
            params: list = [project_id]
            if "chapter_id" in args and args["chapter_id"] is not None:
                conditions.append("chapter_id = ?")
                params.append(args["chapter_id"])
            if "story_line_id" in args and args["story_line_id"] is not None:
                conditions.append("story_line_id = ?")
                params.append(args["story_line_id"])
            where = " AND ".join(conditions)
            rows = await db.execute_fetchall(f"SELECT * FROM timeline_events WHERE {where} ORDER BY day, hour", params)
            events = [dict(r) for r in rows]
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"events": events})

        elif name == "create_storyline":
            sl_id = str(uuid.uuid4())[:8]
            is_main = 1 if args.get("is_main") else 0
            await db.execute(
                "INSERT INTO story_lines (id, project_id, name, color, is_main) VALUES (?, ?, ?, ?, ?)",
                (sl_id, project_id, args["name"], args.get("color"), is_main),
            )
            await db.commit()
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"id": sl_id, "name": args["name"]})

        elif name == "link_event_to_storyline":
            event_id = args["event_id"]
            story_line_id = args["story_line_id"]
            await db.execute(
                "UPDATE timeline_events SET story_line_id = ? WHERE id = ?",
                (story_line_id, event_id),
            )
            await db.commit()
            await db.close()
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"event_id": event_id, "story_line_id": story_line_id})

        else:
            await db.close()
            return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"未知工具: {name}")

    except Exception as e:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=str(e))
