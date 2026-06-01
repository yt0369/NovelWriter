import io
import time
import uuid
import zipfile
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pathlib import Path

from config import settings
from db.database import get_db, init_db
from models.project import ProjectCreate, ProjectMeta
from core.presets.definitions import GENRE_PRESETS
from core.skills.registry import activate_skill

import json as _json

router = APIRouter()


def _parse_tags(r) -> dict:
    """解析项目的 tags JSON 字段。"""
    if hasattr(r, 'keys'):
        tags_raw = r["tags"] if "tags" in r.keys() else "{}"
    else:
        tags_raw = getattr(r, 'tags', '{}') or '{}'
    if isinstance(tags_raw, str):
        try:
            return _json.loads(tags_raw)
        except Exception:
            return {}
    return tags_raw or {}


def _build_project_meta(r) -> ProjectMeta:
    """从数据库行构建 ProjectMeta（支持 dict 和 sqlite3.Row）。"""
    return ProjectMeta(
        id=r["id"], name=r["name"], description=r["description"],
        genre=r["genre"], words_per_chapter=r["words_per_chapter"],
        target_chapters=r["target_chapters"],
        chapters_per_volume=r["chapters_per_volume"],
        preset_id=r["preset_id"],
        tags=_parse_tags(r),
        created_at=r["created_at"], last_modified=r["last_modified"],
    )

# Default project folder structure
DEFAULT_FOLDERS = [
    "基础信息",
    "世界观",
    "角色",
    "章节大纲",
    "灵感",
    "正文",
    "技能",
    "规范",
]

PROJECT_SOUL_TEMPLATE = """# 项目 Soul

本文件记录当前作品专属的协作偏好、文风规则和禁忌。

## 写作偏好
-

## 项目禁忌
-

## 风格要求
-
"""


@router.get("/", response_model=list[ProjectMeta])
async def list_projects():
    projects = []
    projects_dir = settings.projects_dir
    if not projects_dir.exists():
        return projects

    for project_dir in projects_dir.iterdir():
        if not project_dir.is_dir() or project_dir.name.startswith("."):
            continue
        db_path = project_dir / ".novelwriter" / "project.db"
        if db_path.exists():
            db = await get_db(project_dir.name)
            row = await db.execute_fetchall(
                "SELECT * FROM projects WHERE id = ?", (project_dir.name,)
            )
            await db.close()
            if row:
                r = row[0]
                projects.append(_build_project_meta(r))
    return projects


@router.post("/", response_model=ProjectMeta)
async def create_project(req: ProjectCreate):
    project_id = str(uuid.uuid4())[:8]
    now = int(time.time())

    # Create project directory
    project_dir = settings.projects_dir / project_id
    novelwriter_dir = project_dir / ".novelwriter"
    novelwriter_dir.mkdir(parents=True, exist_ok=True)

    # Create default folders
    for folder in DEFAULT_FOLDERS:
        (project_dir / folder).mkdir(exist_ok=True)

    # Initialize database
    await init_db(project_id)

    # Insert project record
    import json
    tags = json.dumps({
        "core_gameplay": req.core_gameplay_tags,
        "narrative_elements": req.narrative_element_tags,
        "style_tone": req.style_tone_tags,
        "romance_line": req.romance_line_tags,
    }, ensure_ascii=False)

    db = await get_db(project_id)
    await db.execute(
        """INSERT INTO projects (id, name, description, genre, words_per_chapter,
           target_chapters, chapters_per_volume, preset_id, tags, created_at, last_modified)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (project_id, req.name, req.description, req.genre,
         req.words_per_chapter, req.target_chapters, req.chapters_per_volume,
         req.preset_id, tags, now, now),
    )
    await db.commit()
    await db.close()

    if req.preset_id and req.preset_id in GENRE_PRESETS:
        preset = GENRE_PRESETS[req.preset_id]
        for skill_name in preset["skills"]:
            activate_skill(skill_name)
            await _upsert_project_skill_setting(project_id, skill_name, "preset")
        rules_path = project_dir / "规范" / "写作规范.md"
        rules_path.parent.mkdir(parents=True, exist_ok=True)
        rules_path.write_text(preset["writing_rules"], encoding="utf-8")
        for folder in preset["extra_folders"]:
            (project_dir / folder).mkdir(parents=True, exist_ok=True)

    soul_path = project_dir / "规范" / "项目Soul.md"
    if not soul_path.exists():
        soul_path.write_text(PROJECT_SOUL_TEMPLATE, encoding="utf-8")

    # 重新读取以获取 tags
    db = await get_db(project_id)
    rows = await db.execute_fetchall("SELECT * FROM projects WHERE id = ?", (project_id,))
    await db.close()
    if rows:
        return _build_project_meta(rows[0])
    # fallback
    return ProjectMeta(
        id=project_id, name=req.name, description=req.description,
        genre=req.genre, words_per_chapter=req.words_per_chapter,
        target_chapters=req.target_chapters,
        chapters_per_volume=req.chapters_per_volume,
        preset_id=req.preset_id, tags={}, created_at=now, last_modified=now,
    )


async def _upsert_project_skill_setting(project_id: str, skill_id: str, source: str):
    now = int(time.time())
    db = await get_db(project_id)
    try:
        await db.execute(
            """INSERT INTO project_skill_settings (id, project_id, skill_id, enabled, source, created_at, updated_at)
               VALUES (?, ?, ?, 1, ?, ?, ?)
               ON CONFLICT(project_id, skill_id)
               DO UPDATE SET enabled = 1, source = excluded.source, updated_at = excluded.updated_at""",
            (str(uuid.uuid4())[:8], project_id, skill_id, source, now, now),
        )
        await db.commit()
    finally:
        await db.close()


@router.get("/{project_id}", response_model=ProjectMeta)
async def get_project(project_id: str):
    db = await get_db(project_id)
    rows = await db.execute_fetchall(
        "SELECT * FROM projects WHERE id = ?", (project_id,)
    )
    await db.close()

    if not rows:
        raise HTTPException(status_code=404, detail="Project not found")

    return _build_project_meta(rows[0])




@router.put("/{project_id}", response_model=ProjectMeta)
async def update_project(project_id: str, req: ProjectCreate):
    import json
    import time as _time
    now = int(_time.time())
    tags = json.dumps({
        "core_gameplay": req.core_gameplay_tags,
        "narrative_elements": req.narrative_element_tags,
        "style_tone": req.style_tone_tags,
        "romance_line": req.romance_line_tags,
    }, ensure_ascii=False)

    db = await get_db(project_id)
    await db.execute(
        """UPDATE projects SET name=?, description=?, genre=?,
           words_per_chapter=?, target_chapters=?, chapters_per_volume=?,
           preset_id=?, tags=?, last_modified=?
           WHERE id=?""",
        (req.name, req.description, req.genre,
         req.words_per_chapter, req.target_chapters, req.chapters_per_volume,
         req.preset_id, tags, now, project_id),
    )
    await db.commit()
    rows = await db.execute_fetchall(
        "SELECT * FROM projects WHERE id = ?", (project_id,)
    )
    await db.close()

    if not rows:
        raise HTTPException(status_code=404, detail="Project not found")

    return _build_project_meta(rows[0])


@router.delete("/{project_id}")
async def delete_project(project_id: str):
    import shutil
    import gc
    import asyncio
    from db.database import _initialized_dbs, get_db

    project_dir = settings.projects_dir / project_id

    # 先关闭数据库连接
    try:
        db = await get_db(project_id)
        await db.close()
    except Exception:
        pass

    # 清理引用
    if project_id in _initialized_dbs:
        _initialized_dbs.discard(project_id)

    # 强制垃圾回收
    gc.collect()
    await asyncio.sleep(0.2)

    if project_dir.exists():
        # Windows 上 SQLite WAL 模式可能残留文件
        db_path = project_dir / ".novelwriter" / "project.db"
        for suffix in ["", "-wal", "-shm"]:
            try:
                (db_path.parent / (db_path.name + suffix)).unlink(missing_ok=True)
            except PermissionError:
                pass

        # 重试删除目录
        for attempt in range(3):
            try:
                shutil.rmtree(project_dir)
                break
            except PermissionError:
                if attempt < 2:
                    gc.collect()
                    await asyncio.sleep(0.3)
                else:
                    raise HTTPException(status_code=500, detail="无法删除项目目录，请关闭其他使用该项目的进程后重试。")
    return {"status": "ok"}


@router.get("/{project_id}/export")
async def export_project(project_id: str):
    """导出项目为zip文件。"""
    project_dir = settings.projects_dir / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for file_path in project_dir.rglob("*"):
            if file_path.is_file():
                # 跳过__pycache__等
                if "__pycache__" in str(file_path):
                    continue
                arcname = str(file_path.relative_to(project_dir))
                zf.write(file_path, arcname)
    buf.seek(0)

    # 获取项目名用于文件名
    db = await get_db(project_id)
    rows = await db.execute_fetchall("SELECT name FROM projects WHERE id = ?", (project_id,))
    await db.close()
    project_name = rows[0]["name"] if rows else project_id

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{project_name}.zip"'},
    )


@router.post("/import")
async def import_project(file: UploadFile = File(...)):
    """从zip文件导入项目。"""
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="请上传zip文件")

    content = await file.read()
    buf = io.BytesIO(content)

    project_id = str(uuid.uuid4())[:8]
    project_dir = settings.projects_dir / project_id

    try:
        with zipfile.ZipFile(buf, 'r') as zf:
            zf.extractall(project_dir)
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="无效的zip文件")

    # 检查是否有数据库，没有则初始化
    db_path = project_dir / ".novelwriter" / "project.db"
    if not db_path.exists():
        await init_db(project_id)
        # 创建基本项目记录
        db = await get_db(project_id)
        now = int(time.time())
        await db.execute(
            "INSERT INTO projects (id, name, description, created_at, last_modified) VALUES (?, ?, ?, ?, ?)",
            (project_id, file.filename.replace(".zip", ""), "", now, now),
        )
        await db.commit()
        await db.close()

    return {"status": "ok", "project_id": project_id}


@router.get("/{project_id}/stats")
async def get_project_stats(project_id: str):
    """获取项目统计信息。"""
    project_dir = settings.projects_dir / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    # 统计文件和字数
    total_chars = 0
    total_files = 0
    chapter_files = 0
    md_files = 0

    for file_path in project_dir.rglob("*"):
        if file_path.is_file() and not file_path.name.startswith(".") and "__pycache__" not in str(file_path):
            total_files += 1
            if file_path.suffix == ".md":
                md_files += 1
                try:
                    content = file_path.read_text(encoding="utf-8")
                    total_chars += len(content)
                    # 检测章节文件（在正文目录下的.md文件）
                    rel = str(file_path.relative_to(project_dir))
                    if rel.startswith("正文/") and file_path.suffix == ".md":
                        chapter_files += 1
                except Exception:
                    pass

    # 获取项目配置
    db = await get_db(project_id)
    rows = await db.execute_fetchall("SELECT * FROM projects WHERE id = ?", (project_id,))
    await db.close()

    target_chapters = 100
    words_per_chapter = 3000
    project_name = project_id
    if rows:
        target_chapters = rows[0]["target_chapters"] or 100
        words_per_chapter = rows[0]["words_per_chapter"] or 3000
        project_name = rows[0]["name"]

    target_words = target_chapters * words_per_chapter
    progress = min(100, int(total_chars / target_words * 100)) if target_words > 0 else 0

    return {
        "project_name": project_name,
        "total_chars": total_chars,
        "total_words": total_chars,  # 中文场景字≈字符
        "total_files": total_files,
        "md_files": md_files,
        "chapter_files": chapter_files,
        "target_chapters": target_chapters,
        "target_words": target_words,
        "progress_percent": progress,
    }
