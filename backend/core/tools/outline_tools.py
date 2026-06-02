from models.tools import ToolDefinition, ToolFunction, ToolCall, ToolResult, ToolResultStatus
from config import settings
from core.pending_changes import create_pending_change


def get_outline_tool_definitions() -> list[ToolDefinition]:
    return [
        ToolDefinition(function=ToolFunction(
            name="create_outline_section",
            description="创建大纲章节（需要用户审批）",
            parameters={"type": "object", "properties": {
                "title": {"type": "string", "description": "大纲标题"},
                "content": {"type": "string", "description": "大纲内容（可选）"},
                "parent_path": {"type": "string", "description": "父级路径，如'卷一'（可选）"},
            }, "required": ["title"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="update_outline_section",
            description="更新大纲内容（需要用户审批）",
            parameters={"type": "object", "properties": {
                "path": {"type": "string", "description": "大纲文件路径，如'章节大纲/卷一_第一章.md'"},
                "content": {"type": "string", "description": "更新后的完整内容"},
            }, "required": ["path", "content"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="get_outline_structure",
            description="获取大纲目录结构",
            parameters={"type": "object", "properties": {}, "required": []},
        )),
    ]


async def execute_outline_tool(tool_call: ToolCall, project_id: str) -> ToolResult:
    name = tool_call.name
    args = tool_call.arguments
    project_dir = settings.projects_dir / project_id

    try:
        if name == "create_outline_section":
            title = args["title"]
            content = args.get("content", f"# {title}\n")
            parent_path = args.get("parent_path", "")

            safe_title = title.replace("/", "_").replace("\\", "_").replace(" ", "_")
            if parent_path:
                safe_parent = parent_path.replace("/", "_").replace("\\", "_").replace(" ", "_")
                rel_path = f"章节大纲/{safe_parent}_{safe_title}.md"
            else:
                rel_path = f"章节大纲/{safe_title}.md"

            file_path = project_dir / rel_path
            original = ""
            if file_path.exists():
                original = file_path.read_text(encoding="utf-8")

            pending_change = await create_pending_change(
                project_id=project_id,
                tool_name=name,
                file_path=rel_path,
                original_content=original,
                new_content=content,
                description=f"创建大纲: {rel_path}",
            )
            return ToolResult(
                status=ToolResultStatus.APPROVAL_REQUIRED,
                tool_name=name,
                pending_change=pending_change,
            )

        elif name == "update_outline_section":
            rel_path = args["path"]
            new_content = args["content"]

            if not rel_path.startswith("章节大纲/"):
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="路径必须在章节大纲/目录下")

            file_path = project_dir / rel_path
            original = ""
            if file_path.exists():
                original = file_path.read_text(encoding="utf-8")
            else:
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"大纲文件不存在: {rel_path}")

            pending_change = await create_pending_change(
                project_id=project_id,
                tool_name=name,
                file_path=rel_path,
                original_content=original,
                new_content=new_content,
                description=f"更新大纲: {rel_path}",
            )
            return ToolResult(
                status=ToolResultStatus.APPROVAL_REQUIRED,
                tool_name=name,
                pending_change=pending_change,
            )

        elif name == "get_outline_structure":
            outline_dir = project_dir / "章节大纲"
            if not outline_dir.exists():
                return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"sections": []})

            sections = []
            for p in sorted(outline_dir.rglob("*.md")):
                if p.is_file():
                    rel = str(p.relative_to(project_dir)).replace("\\", "/")
                    try:
                        first_line = p.read_text(encoding="utf-8").split("\n", 1)[0].lstrip("# ").strip()
                    except Exception:
                        first_line = ""
                    sections.append({"path": rel, "title": first_line})

            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"sections": sections})

        else:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"未知工具: {name}")

    except Exception as e:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=str(e))
