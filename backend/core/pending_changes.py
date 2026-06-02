import asyncio
import logging
import re
import time
import uuid
import json
import shutil
from pathlib import Path, PurePosixPath
from typing import Any

from config import settings
from db.database import get_db
from core.workflows.history import record_workflow_result
from models.tools import PendingChange

logger = logging.getLogger(__name__)

PROTECTED_HIDDEN_DIRS = {".novelwriter"}


class FileSafetyError(ValueError):
    pass


def normalize_project_path(path: str) -> str:
    """Return a safe POSIX-style project-relative path."""
    raw = (path or "").replace("\\", "/").strip()
    if not raw:
        raise FileSafetyError("文件路径不能为空")
    if raw.startswith("/") or re.match(r"^[A-Za-z]:", raw):
        raise FileSafetyError("禁止使用绝对路径")

    pure = PurePosixPath(raw)
    parts = pure.parts
    if any(part in ("", ".", "..") for part in parts):
        raise FileSafetyError("文件路径不能包含空段、当前目录或上级目录")
    if any(part in PROTECTED_HIDDEN_DIRS for part in parts):
        raise FileSafetyError("禁止访问项目内部数据库目录")
    return pure.as_posix()


def resolve_project_file(project_id: str, path: str) -> tuple[str, Path]:
    rel_path = normalize_project_path(path)
    project_dir = (settings.projects_dir / project_id).resolve()
    file_path = (project_dir / rel_path).resolve()
    if project_dir not in file_path.parents and file_path != project_dir:
        raise FileSafetyError("文件路径越出项目目录")
    return rel_path, file_path


def check_ai_write_allowed(rel_path: str):
    from api.files import _get_protection

    protection = _get_protection(rel_path)
    if protection == "IMMUTABLE":
        raise FileSafetyError(f"文件 {rel_path} 受IMMUTABLE保护，禁止AI写入")
    if protection == "AUTO_REBUILD":
        raise FileSafetyError(f"文件 {rel_path} 受AUTO_REBUILD保护，禁止AI写入")


async def save_file_version(project_id: str, file_path: str, content: str, source: str):
    db = await get_db(project_id)
    try:
        await db.execute(
            "INSERT INTO file_versions (id, project_id, file_path, content, source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4())[:8], project_id, file_path, content, source, int(time.time())),
        )
        await db.commit()
    finally:
        await db.close()


async def create_pending_change(
    project_id: str,
    tool_name: str,
    file_path: str,
    original_content: str,
    new_content: str,
    description: str,
    source: str = "agent",
    metadata: dict[str, Any] | None = None,
) -> PendingChange:
    rel_path, _ = resolve_project_file(project_id, file_path)
    check_ai_write_allowed(rel_path)
    change_id = str(uuid.uuid4())[:8]
    now = int(time.time())

    db = await get_db(project_id)
    try:
        await db.execute(
            """INSERT INTO pending_changes
               (id, project_id, tool_name, file_path, original_content, new_content, description, metadata, status, source, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)""",
            (
                change_id, project_id, tool_name, rel_path, original_content, new_content,
                description, json.dumps(metadata or {}, ensure_ascii=False), source, now, now,
            ),
        )
        await db.commit()
    finally:
        await db.close()

    return PendingChange(
        id=change_id,
        tool_name=tool_name,
        file_path=rel_path,
        original_content=original_content,
        new_content=new_content,
        description=description,
        metadata=metadata or {},
    )


def _decode_metadata(row: dict[str, Any]) -> dict[str, Any]:
    raw = row.get("metadata")
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _row_to_pending_change(row) -> dict[str, Any]:
    item = dict(row)
    item["metadata"] = _decode_metadata(item)
    return item


async def list_pending_changes(project_id: str, status: str = "pending") -> list[dict[str, Any]]:
    db = await get_db(project_id)
    try:
        cursor = await db.execute(
            "SELECT * FROM pending_changes WHERE project_id = ? AND status = ? ORDER BY created_at DESC",
            (project_id, status),
        )
        rows = await cursor.fetchall()
        return [_row_to_pending_change(row) for row in rows]
    finally:
        await db.close()


async def get_pending_change(project_id: str, change_id: str) -> dict[str, Any] | None:
    db = await get_db(project_id)
    try:
        cursor = await db.execute(
            "SELECT * FROM pending_changes WHERE project_id = ? AND id = ?",
            (project_id, change_id),
        )
        row = await cursor.fetchone()
        return _row_to_pending_change(row) if row else None
    finally:
        await db.close()


def _resolve_rename_target(project_id: str, current_path: Path, new_name: str) -> tuple[str, Path]:
    clean_name = (new_name or "").replace("\\", "/").strip()
    pure_name = PurePosixPath(clean_name)
    if not clean_name or len(pure_name.parts) != 1 or pure_name.name in {"", ".", ".."}:
        raise FileSafetyError("重命名目标只能是单个文件名，不能包含路径")
    if pure_name.name in PROTECTED_HIDDEN_DIRS:
        raise FileSafetyError("禁止重命名为项目内部数据库目录")

    project_dir = (settings.projects_dir / project_id).resolve()
    new_path = (current_path.parent / pure_name.name).resolve()
    if project_dir not in new_path.parents and new_path != project_dir:
        raise FileSafetyError("重命名目标越出项目目录")

    new_rel = str(new_path.relative_to(project_dir)).replace("\\", "/")
    check_ai_write_allowed(new_rel)
    if new_path.exists():
        raise FileSafetyError(f"目标已存在: {new_rel}")
    return new_rel, new_path


async def approve_pending_change(project_id: str, change_id: str, source: str = "agent") -> dict[str, Any]:
    change = await get_pending_change(project_id, change_id)
    if not change:
        raise FileSafetyError(f"未找到待审批变更: {change_id}")
    if change["status"] != "pending":
        raise FileSafetyError(f"变更 {change_id} 当前状态为 {change['status']}，不能批准")

    rel_path, file_path = resolve_project_file(project_id, change["file_path"])
    check_ai_write_allowed(rel_path)
    tool_name = change["tool_name"]
    result_path = rel_path
    extra_output: dict[str, Any] = {}

    if tool_name == "delete_file":
        if not file_path.exists():
            raise FileSafetyError(f"文件不存在: {rel_path}")
        if file_path.is_file():
            await save_file_version(project_id, rel_path, file_path.read_text(encoding="utf-8"), source)
            file_path.unlink()
        elif file_path.is_dir():
            shutil.rmtree(file_path)
        else:
            file_path.unlink()
        extra_output["operation"] = "delete"

    elif tool_name == "rename_file":
        if not file_path.exists():
            raise FileSafetyError(f"文件不存在: {rel_path}")
        new_rel, new_path = _resolve_rename_target(project_id, file_path, change["new_content"])
        if file_path.is_file():
            await save_file_version(project_id, rel_path, file_path.read_text(encoding="utf-8"), source)
        file_path.rename(new_path)
        result_path = new_rel
        extra_output.update({"operation": "rename", "old_file_path": rel_path, "file_path": new_rel})

    else:
        if file_path.exists() and file_path.is_file():
            await save_file_version(project_id, rel_path, file_path.read_text(encoding="utf-8"), source)

        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(change["new_content"], encoding="utf-8")
        schedule_post_commit_records(project_id, rel_path, change["new_content"])
        extra_output["operation"] = "write"

    now = int(time.time())
    db = await get_db(project_id)
    try:
        await db.execute(
            "UPDATE pending_changes SET status = 'approved', updated_at = ? WHERE project_id = ? AND id = ?",
            (now, project_id, change_id),
        )
        await db.commit()
    finally:
        await db.close()

    return await record_workflow_result(
        project_id,
        "pending_change_approval",
        "approved",
        {"change_id": change_id, "source": source, "tool_name": tool_name},
        {
            "id": change_id,
            "file_path": result_path,
            "source": source,
            "tool_name": tool_name,
            **extra_output,
        },
    )


def schedule_post_commit_records(project_id: str, file_path: str, content: str):
    """Run post-approval knowledge extraction without delaying approval UX."""
    if not file_path.startswith("正文/") or not file_path.endswith(".md"):
        return

    async def _run():
        try:
            await create_post_commit_records(project_id, file_path, content)
        except Exception:
            logger.exception("post-commit knowledge extraction failed for %s/%s", project_id, file_path)

    try:
        asyncio.get_running_loop().create_task(_run())
    except RuntimeError:
        logger.debug("no running event loop; skipping async post-commit extraction for %s/%s", project_id, file_path)


async def create_post_commit_records(project_id: str, file_path: str, content: str):
    """Queue structured knowledge candidates after an approved chapter write."""
    from core.memory.candidates import queue_chapter_knowledge_candidates

    provider = None
    if settings.api_key:
        from ai.openai_provider import OpenAIProvider

        provider = OpenAIProvider()
    await queue_chapter_knowledge_candidates(project_id, file_path, content, provider)


def _summarize_text(content: str, limit: int = 500) -> str:
    compact = " ".join(line.strip() for line in content.splitlines() if line.strip())
    return compact[:limit]


def json_dumps(data: Any) -> str:
    import json
    return json.dumps(data, ensure_ascii=False)


async def reject_pending_change(project_id: str, change_id: str) -> dict[str, Any]:
    change = await get_pending_change(project_id, change_id)
    if not change:
        raise FileSafetyError(f"未找到待审批变更: {change_id}")
    now = int(time.time())
    db = await get_db(project_id)
    try:
        await db.execute(
            "UPDATE pending_changes SET status = 'rejected', updated_at = ? WHERE project_id = ? AND id = ?",
            (now, project_id, change_id),
        )
        await db.commit()
    finally:
        await db.close()
    return await record_workflow_result(
        project_id,
        "pending_change_reject",
        "rejected",
        {"change_id": change_id, "tool_name": change["tool_name"]},
        {"id": change_id, "tool_name": change["tool_name"]},
    )


async def revise_pending_change(project_id: str, change_id: str, new_content: str, description: str | None = None) -> PendingChange:
    change = await get_pending_change(project_id, change_id)
    if not change:
        raise FileSafetyError(f"未找到待审批变更: {change_id}")
    if change["status"] != "pending":
        raise FileSafetyError(f"变更 {change_id} 当前状态为 {change['status']}，不能修改")
    now = int(time.time())
    desc = description or change.get("description") or "修订待审批变更"
    db = await get_db(project_id)
    try:
        await db.execute(
            "UPDATE pending_changes SET new_content = ?, description = ?, updated_at = ? WHERE project_id = ? AND id = ?",
            (new_content, desc, now, project_id, change_id),
        )
        await db.commit()
    finally:
        await db.close()
    await record_workflow_result(
        project_id,
        "pending_change_revise",
        "updated",
        {"change_id": change_id},
        {
            "id": change_id,
            "file_path": change["file_path"],
            "description": desc,
        },
    )
    return PendingChange(
        id=change_id,
        tool_name=change["tool_name"],
        file_path=change["file_path"],
        original_content=change["original_content"],
        new_content=new_content,
        description=desc,
        metadata=_decode_metadata(change),
    )


async def update_pending_change_edit_status(
    project_id: str,
    change_id: str,
    edit_id: str,
    status: str,
) -> PendingChange:
    change = await get_pending_change(project_id, change_id)
    if not change:
        raise FileSafetyError(f"未找到待审批变更: {change_id}")
    if change["status"] != "pending":
        raise FileSafetyError(f"变更 {change_id} 当前状态为 {change['status']}，不能修改")

    metadata = _decode_metadata(change)
    edits = metadata.get("edits")
    if not isinstance(edits, list):
        raise FileSafetyError("该变更不包含可单独处理的 edit")

    found = False
    for edit in edits:
        if isinstance(edit, dict) and edit.get("id") == edit_id:
            edit["status"] = status
            found = True
            break
    if not found:
        raise FileSafetyError(f"未找到 edit: {edit_id}")

    new_content = _apply_active_edits(change["original_content"], edits)
    now = int(time.time())
    db = await get_db(project_id)
    try:
        await db.execute(
            "UPDATE pending_changes SET new_content = ?, metadata = ?, updated_at = ? WHERE project_id = ? AND id = ?",
            (new_content, json.dumps(metadata, ensure_ascii=False), now, project_id, change_id),
        )
        await db.commit()
    finally:
        await db.close()

    await record_workflow_result(
        project_id,
        "pending_change_edit_update",
        status,
        {"change_id": change_id, "edit_id": edit_id},
        {"id": change_id, "file_path": change["file_path"], "edit_id": edit_id, "status": status},
    )
    return PendingChange(
        id=change_id,
        tool_name=change["tool_name"],
        file_path=change["file_path"],
        original_content=change["original_content"],
        new_content=new_content,
        description=change.get("description") or "",
        metadata=metadata,
    )


def _apply_active_edits(original: str, edits: list[Any]) -> str:
    content = original
    for edit in edits:
        if not isinstance(edit, dict) or edit.get("status") == "rejected":
            continue
        old_text = str(edit.get("old_text", ""))
        new_text = str(edit.get("new_text", ""))
        replace_all = bool(edit.get("replace_all"))
        if not old_text:
            continue
        if replace_all:
            content = content.replace(old_text, new_text)
        elif old_text in content:
            content = content.replace(old_text, new_text, 1)
    return content
