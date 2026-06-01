"""
项目元数据工具：更新项目名称、类型、字数目标等。
"""
import time

from models.tools import ToolDefinition, ToolFunction, ToolCall, ToolResult, ToolResultStatus
from db.database import get_db


def get_project_tool_definitions() -> list[ToolDefinition]:
    return [
        ToolDefinition(function=ToolFunction(
            name="update_project_meta",
            description="""更新项目元数据（书名、类型、字数目标、核心梗等）。
触发词："更新项目档案"、"更新项目设定"、"修改书名"、"改类型"、"调整字数目标"等。
注意：这是修改系统内部配置，不需要写文件。""",
            parameters={"type": "object", "properties": {
                "name": {"type": "string", "description": "书名"},
                "description": {"type": "string", "description": "核心梗/简介（≤300字）"},
                "genre": {"type": "string", "description": "类型（如：玄幻、都市、科幻）"},
                "words_per_chapter": {"type": "integer", "description": "每章目标字数"},
                "target_chapters": {"type": "integer", "description": "目标总章节数"},
                "chapters_per_volume": {"type": "integer", "description": "每卷章节数"},
            }, "required": []},
        )),
    ]


async def execute_project_tool(tool_call: ToolCall, project_id: str) -> ToolResult:
    name = tool_call.name
    args = tool_call.arguments

    try:
        if name == "update_project_meta":
            db = await get_db(project_id)

            # 构建更新字段
            updates = {}
            for key in ("name", "description", "genre", "words_per_chapter", "target_chapters", "chapters_per_volume"):
                if key in args and args[key] is not None:
                    updates[key] = args[key]

            if not updates:
                await db.close()
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="没有需要更新的字段")

            updates["last_modified"] = int(time.time())
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            values = list(updates.values()) + [project_id]

            await db.execute(f"UPDATE projects SET {set_clause} WHERE id = ?", values)
            await db.commit()

            # 查询更新后的数据
            rows = await db.execute_fetchall("SELECT * FROM projects WHERE id = ?", (project_id,))
            await db.close()

            result = dict(rows[0]) if rows else {}
            return ToolResult(
                status=ToolResultStatus.EXECUTED,
                tool_name=name,
                result={"updated": list(updates.keys()), "project": result},
            )

        else:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"未知工具: {name}")

    except Exception as e:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=str(e))
