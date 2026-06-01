import re
import time
import uuid
from pathlib import Path, PurePosixPath
from typing import Any

from config import settings
from db.database import get_db
from core.workflows.history import record_workflow_result
from models.tools import PendingChange


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
) -> PendingChange:
    rel_path, _ = resolve_project_file(project_id, file_path)
    check_ai_write_allowed(rel_path)
    change_id = str(uuid.uuid4())[:8]
    now = int(time.time())

    db = await get_db(project_id)
    try:
        await db.execute(
            """INSERT INTO pending_changes
               (id, project_id, tool_name, file_path, original_content, new_content, description, status, source, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)""",
            (change_id, project_id, tool_name, rel_path, original_content, new_content, description, source, now, now),
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
    )


async def list_pending_changes(project_id: str, status: str = "pending") -> list[dict[str, Any]]:
    db = await get_db(project_id)
    try:
        cursor = await db.execute(
            "SELECT * FROM pending_changes WHERE project_id = ? AND status = ? ORDER BY created_at DESC",
            (project_id, status),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
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
        return dict(row) if row else None
    finally:
        await db.close()


async def approve_pending_change(project_id: str, change_id: str, source: str = "agent") -> dict[str, Any]:
    change = await get_pending_change(project_id, change_id)
    if not change:
        raise FileSafetyError(f"未找到待审批变更: {change_id}")
    if change["status"] != "pending":
        raise FileSafetyError(f"变更 {change_id} 当前状态为 {change['status']}，不能批准")

    rel_path, file_path = resolve_project_file(project_id, change["file_path"])
    check_ai_write_allowed(rel_path)

    current_content = ""
    if file_path.exists():
        current_content = file_path.read_text(encoding="utf-8")
        await save_file_version(project_id, rel_path, current_content, source)

    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(change["new_content"], encoding="utf-8")
    await create_post_commit_records(project_id, rel_path, change["new_content"])
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
        {"change_id": change_id, "source": source, "tool_name": change["tool_name"]},
        {
            "id": change_id,
            "file_path": rel_path,
            "source": source,
            "tool_name": change["tool_name"],
        },
    )


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
    )
