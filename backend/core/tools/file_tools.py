import json
import uuid
from pathlib import Path
from typing import Any

from models.tools import ToolDefinition, ToolFunction, ToolCall, ToolResult, ToolResultStatus, PendingChange
from config import settings
from api.files import _get_protection
from core.pending_changes import (
    FileSafetyError,
    create_pending_change,
    normalize_project_path,
    resolve_project_file,
)


def get_file_tool_definitions() -> list[ToolDefinition]:
    return [
        ToolDefinition(function=ToolFunction(
            name="read_file",
            description="读取文件内容",
            parameters={"type": "object", "properties": {"path": {"type": "string", "description": "文件路径"}}, "required": ["path"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="write_file",
            description="写入文件内容（需要用户审批）",
            parameters={"type": "object", "properties": {
                "path": {"type": "string", "description": "文件路径"},
                "content": {"type": "string", "description": "文件内容"},
            }, "required": ["path", "content"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="patch_file",
            description="查找替换文件内容（需要用户审批）",
            parameters={"type": "object", "properties": {
                "path": {"type": "string", "description": "文件路径"},
                "old_text": {"type": "string", "description": "要替换的原文"},
                "new_text": {"type": "string", "description": "替换后的内容"},
            }, "required": ["path", "old_text", "new_text"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="glob",
            description="按模式搜索文件",
            parameters={"type": "object", "properties": {
                "pattern": {"type": "string", "description": "glob模式，如 **/*.md"},
            }, "required": ["pattern"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="grep",
            description="在文件中搜索文本",
            parameters={"type": "object", "properties": {
                "query": {"type": "string", "description": "搜索关键词"},
                "path": {"type": "string", "description": "搜索路径（可选）"},
            }, "required": ["query"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="delete_file",
            description="删除文件或文件夹（需要用户审批）",
            parameters={"type": "object", "properties": {
                "path": {"type": "string", "description": "文件或文件夹路径"},
            }, "required": ["path"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="rename_file",
            description="重命名文件或文件夹（需要用户审批）",
            parameters={"type": "object", "properties": {
                "old_path": {"type": "string", "description": "原路径"},
                "new_name": {"type": "string", "description": "新名称（不含路径）"},
            }, "required": ["old_path", "new_name"]},
        )),
    ]


async def execute_file_tool(tool_call: ToolCall, project_id: str) -> ToolResult:
    project_dir = settings.projects_dir / project_id
    name = tool_call.name
    args = tool_call.arguments

    try:
        if name == "read_file":
            rel_path, file_path = resolve_project_file(project_id, args["path"])
            if not file_path.exists():
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"文件不存在: {rel_path}")
            content = file_path.read_text(encoding="utf-8")
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"path": rel_path, "content": content})

        elif name == "write_file":
            rel_path, file_path = resolve_project_file(project_id, args["path"])
            # 检查文件保护
            protection = _get_protection(rel_path)
            if protection == "IMMUTABLE":
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"文件 {rel_path} 受IMMUTABLE保护，禁止AI写入")
            if protection == "AUTO_REBUILD":
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"文件 {rel_path} 受AUTO_REBUILD保护，禁止AI写入")

            new_content = args["content"]

            original = ""
            if file_path.exists():
                original = file_path.read_text(encoding="utf-8")

            pending_change = await create_pending_change(
                project_id=project_id,
                tool_name=name,
                file_path=rel_path,
                original_content=original,
                new_content=new_content,
                description=f"写入文件: {rel_path}",
            )
            return ToolResult(
                status=ToolResultStatus.APPROVAL_REQUIRED,
                tool_name=name,
                pending_change=pending_change,
            )

        elif name == "patch_file":
            rel_path, file_path = resolve_project_file(project_id, args["path"])
            # 检查文件保护
            protection = _get_protection(rel_path)
            if protection == "IMMUTABLE":
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"文件 {rel_path} 受IMMUTABLE保护，禁止AI修改")
            if protection == "AUTO_REBUILD":
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"文件 {rel_path} 受AUTO_REBUILD保护，禁止AI修改")

            old_text = args["old_text"]
            new_text = args["new_text"]
            if not file_path.exists():
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"文件不存在: {rel_path}")

            original = file_path.read_text(encoding="utf-8")
            if old_text not in original:
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"未找到匹配文本")

            patched = original.replace(old_text, new_text, 1)
            pending_change = await create_pending_change(
                project_id=project_id,
                tool_name=name,
                file_path=rel_path,
                original_content=original,
                new_content=patched,
                description=f"替换文件内容: {rel_path}",
            )
            return ToolResult(
                status=ToolResultStatus.APPROVAL_REQUIRED,
                tool_name=name,
                pending_change=pending_change,
            )

        elif name == "glob":
            from pathlib import PurePosixPath
            pattern = args["pattern"]
            if ".." in PurePosixPath(pattern.replace("\\", "/")).parts:
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="glob模式不能包含上级目录")
            matches = []
            for p in project_dir.glob(pattern):
                if p.is_file() and project_dir.resolve() in p.resolve().parents:
                    matches.append(str(p.relative_to(project_dir)).replace("\\", "/"))
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"matches": sorted(matches)})

        elif name == "grep":
            query = args["query"]
            search_path = args.get("path", "")
            if search_path:
                _, target = resolve_project_file(project_id, search_path)
            else:
                target = project_dir
            results = []
            for p in target.rglob("*.md"):
                try:
                    content = p.read_text(encoding="utf-8")
                    if query in content:
                        rel = str(p.relative_to(project_dir)).replace("\\", "/")
                        lines = content.split("\n")
                        matches = [{"line": i + 1, "text": line.strip()} for i, line in enumerate(lines) if query in line][:5]
                        results.append({"file": rel, "matches": matches})
                except:
                    pass
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"results": results})

        elif name == "delete_file":
            rel_path, file_path = resolve_project_file(project_id, args["path"])
            protection = _get_protection(rel_path)
            if protection == "IMMUTABLE":
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"文件 {rel_path} 受IMMUTABLE保护，禁止删除")
            if not file_path.exists():
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"文件不存在: {rel_path}")
            # 删除操作需要审批
            original = file_path.read_text(encoding="utf-8") if file_path.is_file() else "[目录]"
            pending_change = await create_pending_change(
                project_id=project_id,
                tool_name=name,
                file_path=rel_path,
                original_content=original,
                new_content="",
                description=f"删除{'目录' if file_path.is_dir() else '文件'}: {rel_path}",
            )
            return ToolResult(
                status=ToolResultStatus.APPROVAL_REQUIRED,
                tool_name=name,
                pending_change=pending_change,
            )

        elif name == "rename_file":
            old_rel, old_path = resolve_project_file(project_id, args["old_path"])
            new_name = args["new_name"]
            protection = _get_protection(old_rel)
            if protection == "IMMUTABLE":
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"文件 {old_rel} 受IMMUTABLE保护，禁止重命名")
            if not old_path.exists():
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"文件不存在: {old_rel}")
            new_path = old_path.parent / new_name
            new_rel = str(new_path.relative_to(project_dir)).replace("\\", "/")
            if new_path.exists():
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"目标已存在: {new_rel}")
            # 重命名操作需要审批
            original = old_path.read_text(encoding="utf-8") if old_path.is_file() else "[目录]"
            pending_change = await create_pending_change(
                project_id=project_id,
                tool_name=name,
                file_path=old_rel,
                original_content=original,
                new_content=new_name,
                description=f"重命名 {old_rel} → {new_name}",
            )
            return ToolResult(
                status=ToolResultStatus.APPROVAL_REQUIRED,
                tool_name=name,
                pending_change=pending_change,
            )

        else:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"未知工具: {name}")

    except FileSafetyError as e:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=str(e))
    except Exception as e:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=str(e))
