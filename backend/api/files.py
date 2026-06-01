import time
import uuid
from fastapi import APIRouter, HTTPException
from pathlib import Path

from config import settings
from models.file_node import FileNode, FileContent, FilePatch
from db.database import get_db
from core.pending_changes import FileSafetyError, normalize_project_path, resolve_project_file, save_file_version
from core.workflows.history import record_workflow_result

router = APIRouter()

# 文件保护规则：目录前缀 → 保护级别
PROTECTION_RULES: dict[str, str] = {
    "规范/": "IMMUTABLE",
    ".novelwriter/": "IMMUTABLE",
    "基础信息/": "PERSISTENT",
    "世界观/": "PERSISTENT",
    "角色/": "PERSISTENT",
    "技能/": "AUTO_REBUILD",
}

_REBUILD_TEMPLATES: dict[str, str] = {
    "技能/默认技能.md": "# 默认技能配置\n\n此目录存放项目的技能配置文件。\n\n## 可用技能\n- 初稿写作\n- 角色设计师\n- 大纲架构师\n- 编辑审核\n- 文本润色\n",
}


def _get_protection(rel_path: str) -> str | None:
    """根据路径前缀判断文件保护级别。"""
    for prefix, level in PROTECTION_RULES.items():
        if rel_path.startswith(prefix):
            return level
    return None


def scan_directory(dir_path: Path, base_path: Path) -> list[FileNode]:
    nodes = []
    if not dir_path.exists():
        return nodes

    for item in sorted(dir_path.iterdir(), key=lambda x: (not x.is_dir(), x.name)):
        if item.name.startswith(".") or item.name == "__pycache__":
            continue

        rel_path = str(item.relative_to(base_path)).replace("\\", "/")
        protection = _get_protection(rel_path)

        if item.is_dir():
            children = scan_directory(item, base_path)
            nodes.append(FileNode(
                name=item.name, path=rel_path, is_dir=True,
                children=children, protection=protection,
            ))
        else:
            nodes.append(FileNode(
                name=item.name, path=rel_path, is_dir=False,
                size=item.stat().st_size, protection=protection,
            ))

    return nodes


def _check_protection(project_id: str, rel_path: str, action: str = "write"):
    rel_path = normalize_project_path(rel_path)
    protection = _get_protection(rel_path)
    if protection == "IMMUTABLE":
        raise HTTPException(
            status_code=403,
            detail=f"文件 {rel_path} 受IMMUTABLE保护，禁止{action}。如需修改，请在编辑器中手动操作。"
        )
    if protection == "AUTO_REBUILD" and action != "删除":
        raise HTTPException(
            status_code=403,
            detail=f"文件 {rel_path} 受AUTO_REBUILD保护，禁止{action}。"
        )


async def _save_version(project_id: str, file_path: str, content: str, source: str = "manual"):
    try:
        await save_file_version(project_id, file_path, content, source)
    except Exception:
        pass


def _check_and_rebuild(project_id: str):
    project_dir = settings.projects_dir / project_id
    for rel_path, content in _REBUILD_TEMPLATES.items():
        file_path = project_dir / rel_path
        protection = _get_protection(rel_path)
        if protection == "AUTO_REBUILD" and not file_path.exists():
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(content, encoding="utf-8")


@router.get("/{project_id}/tree", response_model=list[FileNode])
async def get_file_tree(project_id: str):
    project_dir = settings.projects_dir / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    return scan_directory(project_dir, project_dir)


@router.get("/{project_id}/read")
async def read_file(project_id: str, path: str):
    try:
        path, file_path = resolve_project_file(project_id, path)
    except FileSafetyError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not file_path.is_file():
        raise HTTPException(status_code=400, detail="Not a file")

    content = file_path.read_text(encoding="utf-8")
    return FileContent(path=path, content=content)


@router.put("/{project_id}/write")
async def write_file(project_id: str, body: FileContent):
    try:
        rel_path, file_path = resolve_project_file(project_id, body.path)
        _check_protection(project_id, rel_path, "写入")
    except FileSafetyError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # 保存旧版本
    if file_path.exists():
        old_content = file_path.read_text(encoding="utf-8")
        await _save_version(project_id, rel_path, old_content, "manual")

    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(body.content, encoding="utf-8")
    return {"status": "ok", "path": rel_path}


@router.post("/{project_id}/patch")
async def patch_file(project_id: str, body: FilePatch):
    try:
        rel_path, file_path = resolve_project_file(project_id, body.path)
        _check_protection(project_id, rel_path, "修改")
    except FileSafetyError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    current = file_path.read_text(encoding="utf-8")
    if current != body.old_content:
        raise HTTPException(status_code=409, detail="File content has changed")

    # 保存旧版本
    await _save_version(project_id, rel_path, current, "manual")

    file_path.write_text(body.new_content, encoding="utf-8")
    return {"status": "ok", "path": rel_path}


@router.post("/{project_id}/mkdir")
async def create_directory(project_id: str, path: str):
    try:
        rel_path, dir_path = resolve_project_file(project_id, path)
    except FileSafetyError as e:
        raise HTTPException(status_code=400, detail=str(e))
    dir_path.mkdir(parents=True, exist_ok=True)
    return {"status": "ok", "path": rel_path}


@router.delete("/{project_id}/delete")
async def delete_file(project_id: str, path: str):
    try:
        rel_path, target = resolve_project_file(project_id, path)
        _check_protection(project_id, rel_path, "删除")
    except FileSafetyError as e:
        raise HTTPException(status_code=400, detail=str(e))
    import shutil
    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    _check_and_rebuild(project_id)
    return {"status": "ok", "path": rel_path}


@router.get("/{project_id}/versions")
async def get_file_versions(project_id: str, path: str):
    """获取文件的版本历史。"""
    try:
        path = normalize_project_path(path)
    except FileSafetyError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db = await get_db(project_id)
    try:
        cursor = await db.execute(
            "SELECT id, file_path, source, created_at FROM file_versions WHERE project_id = ? AND file_path = ? ORDER BY created_at DESC LIMIT 20",
            (project_id, path),
        )
        rows = await cursor.fetchall()
        return [{"id": r["id"], "file_path": r["file_path"], "source": r["source"], "created_at": r["created_at"]} for r in rows]
    finally:
        await db.close()


@router.get("/{project_id}/versions/{version_id}")
async def get_version_content(project_id: str, version_id: str):
    """获取某个版本的完整内容。"""
    db = await get_db(project_id)
    try:
        cursor = await db.execute(
            "SELECT content FROM file_versions WHERE id = ? AND project_id = ?",
            (version_id, project_id),
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Version not found")
        return {"content": row["content"]}
    finally:
        await db.close()


@router.post("/{project_id}/versions/{version_id}/restore")
async def restore_version(project_id: str, version_id: str):
    """恢复某个文件版本。"""
    db = await get_db(project_id)
    try:
        cursor = await db.execute(
            "SELECT file_path, content FROM file_versions WHERE id = ? AND project_id = ?",
            (version_id, project_id),
        )
        row = await cursor.fetchone()
    finally:
        await db.close()

    if not row:
        raise HTTPException(status_code=404, detail="Version not found")

    try:
        rel_path, file_path = resolve_project_file(project_id, row["file_path"])
        _check_protection(project_id, rel_path, "恢复")
    except FileSafetyError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if file_path.exists():
        await _save_version(project_id, rel_path, file_path.read_text(encoding="utf-8"), "restore")
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(row["content"], encoding="utf-8")
    return await record_workflow_result(
        project_id,
        "file_restore",
        "completed",
        {"version_id": version_id, "path": rel_path},
        {"path": rel_path, "restored_version_id": version_id},
    )
