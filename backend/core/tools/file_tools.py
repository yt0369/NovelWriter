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
    list_pending_changes,
    normalize_project_path,
    resolve_project_file,
)


def _slice_lines(content: str, start_line: int | None, end_line: int | None) -> tuple[str, dict[str, Any]]:
    lines = content.splitlines()
    total_lines = len(lines)
    if start_line is None and end_line is None:
        return content, {"total_lines": total_lines, "returned_start_line": 1 if total_lines else 0, "returned_end_line": total_lines}
    start = max(1, int(start_line or 1))
    end = min(total_lines, int(end_line or total_lines))
    if end < start:
        return "", {"total_lines": total_lines, "returned_start_line": start, "returned_end_line": end}
    return "\n".join(lines[start - 1:end]), {
        "total_lines": total_lines,
        "returned_start_line": start,
        "returned_end_line": end,
    }


async def _shadow_content_for_path(project_id: str, rel_path: str) -> tuple[str | None, str | None]:
    changes = await list_pending_changes(project_id)
    for change in changes:
        if change.get("file_path") == rel_path:
            return change.get("new_content", ""), change.get("id", "")
    return None, None


def _normalize_patch_edits(args: dict[str, Any]) -> list[dict[str, Any]]:
    raw_edits = args.get("edits")
    if isinstance(raw_edits, list) and raw_edits:
        edits = []
        for index, raw in enumerate(raw_edits):
            if not isinstance(raw, dict):
                continue
            edits.append({
                "id": str(raw.get("id") or f"edit-{index + 1}"),
                "old_text": str(raw.get("old_text", "")),
                "new_text": str(raw.get("new_text", "")),
                "replace_all": bool(raw.get("replace_all", False)),
                "status": str(raw.get("status") or "pending"),
            })
        return edits
    return [{
        "id": "edit-1",
        "old_text": str(args.get("old_text", "")),
        "new_text": str(args.get("new_text", "")),
        "replace_all": bool(args.get("replace_all", False)),
        "status": "pending",
    }]


def _apply_patch_edits(original: str, edits: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]]]:
    content = original
    reports: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for edit in edits:
        old_text = edit.get("old_text", "")
        new_text = edit.get("new_text", "")
        replace_all = bool(edit.get("replace_all"))
        match_count = content.count(old_text) if old_text else 0
        report = {
            "id": edit["id"],
            "match_count": match_count,
            "replace_all": replace_all,
            "status": "matched" if match_count else "failed",
        }
        if not old_text:
            report["reason"] = "old_text 不能为空"
            report["suggestion"] = "提供要替换的精确原文，或先 read_file 获取最新片段。"
            failures.append(report)
        elif match_count == 0:
            report["reason"] = "未找到匹配文本"
            report["suggestion"] = "先 read_file 读取目标行范围，确认 old_text 与文件内容完全一致。"
            failures.append(report)
        else:
            content = content.replace(old_text, new_text) if replace_all else content.replace(old_text, new_text, 1)
            if match_count > 1 and not replace_all:
                report["suggestion"] = "找到多处匹配，当前只替换第一处；如需全部替换请传 replace_all=true。"
        reports.append(report)
    return content, reports, failures


def get_file_tool_definitions() -> list[ToolDefinition]:
    return [
        ToolDefinition(function=ToolFunction(
            name="read_file",
            description="读取文件内容",
            parameters={"type": "object", "properties": {
                "path": {"type": "string", "description": "文件路径"},
                "start_line": {"type": "integer", "description": "起始行号（可选，1-based）"},
                "end_line": {"type": "integer", "description": "结束行号（可选，包含该行）"},
                "include_pending": {"type": "boolean", "description": "是否优先读取同路径待审批内容（默认 true）"},
            }, "required": ["path"]},
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
                "replace_all": {"type": "boolean", "description": "是否替换全部匹配，默认只替换第一处"},
                "edits": {"type": "array", "description": "批量替换列表。提供后优先使用 edits，每项包含 id/old_text/new_text/replace_all。", "items": {"type": "object", "properties": {
                    "id": {"type": "string"},
                    "old_text": {"type": "string"},
                    "new_text": {"type": "string"},
                    "replace_all": {"type": "boolean"},
                }}},
            }, "required": ["path"]},
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
            source = "disk"
            pending_change_id = ""
            if args.get("include_pending", True):
                shadow_content, shadow_id = await _shadow_content_for_path(project_id, rel_path)
                if shadow_content is not None:
                    content = shadow_content
                    source = "pending_shadow"
                    pending_change_id = shadow_id or ""
            sliced, line_meta = _slice_lines(content, args.get("start_line"), args.get("end_line"))
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={
                "path": rel_path,
                "content": sliced,
                "source": source,
                "pending_change_id": pending_change_id,
                **line_meta,
            })

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

            edits = _normalize_patch_edits(args)
            if not file_path.exists():
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"文件不存在: {rel_path}")

            original = file_path.read_text(encoding="utf-8")
            patched, patch_report, failures = _apply_patch_edits(original, edits)
            if failures:
                return ToolResult(
                    status=ToolResultStatus.ERROR,
                    tool_name=name,
                    error="; ".join(f"{item['id']}: {item.get('reason', '替换失败')}" for item in failures),
                    result={"patch_report": patch_report, "failures": failures},
                )

            pending_change = await create_pending_change(
                project_id=project_id,
                tool_name=name,
                file_path=rel_path,
                original_content=original,
                new_content=patched,
                description=f"替换文件内容: {rel_path}",
                metadata={"edits": edits, "patch_report": patch_report},
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
