"""
伏笔追踪API：生命周期管理（埋设→发展→回收→过期）。
"""
import time
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.database import get_db

router = APIRouter()


class ForeshadowCreate(BaseModel):
    name: str
    description: str = ""
    plant_chapter_id: str | None = None
    resolve_chapter_id: str | None = None
    status: str = "planted"  # planted / developing / resolved / expired


class ForeshadowUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    plant_chapter_id: str | None = None
    resolve_chapter_id: str | None = None
    status: str | None = None


@router.get("/{project_id}")
async def list_foreshadowing(project_id: str, status: str | None = None):
    db = await get_db(project_id)
    if status:
        rows = await db.execute_fetchall(
            "SELECT * FROM foreshadowing WHERE project_id = ? AND status = ? ORDER BY created_at DESC",
            (project_id, status),
        )
    else:
        rows = await db.execute_fetchall(
            "SELECT * FROM foreshadowing WHERE project_id = ? ORDER BY created_at DESC",
            (project_id,),
        )
    await db.close()
    return [dict(r) for r in rows]


@router.post("/{project_id}")
async def create_foreshadowing(project_id: str, body: ForeshadowCreate):
    fid = str(uuid.uuid4())[:8]
    now = int(time.time())
    db = await get_db(project_id)
    await db.execute(
        "INSERT INTO foreshadowing (id, project_id, name, description, plant_chapter_id, resolve_chapter_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (fid, project_id, body.name, body.description, body.plant_chapter_id, body.resolve_chapter_id, body.status, now),
    )
    await db.commit()
    await db.close()
    return {"id": fid, "name": body.name, "status": body.status}


@router.patch("/{project_id}/{foreshadow_id}")
async def update_foreshadowing(project_id: str, foreshadow_id: str, body: ForeshadowUpdate):
    db = await get_db(project_id)
    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        await db.execute(f"UPDATE foreshadowing SET {set_clause} WHERE id = ?", list(updates.values()) + [foreshadow_id])
        await db.commit()
    await db.close()
    return {"status": "updated"}


@router.delete("/{project_id}/{foreshadow_id}")
async def delete_foreshadowing(project_id: str, foreshadow_id: str):
    db = await get_db(project_id)
    await db.execute("DELETE FROM foreshadowing WHERE id = ?", (foreshadow_id,))
    await db.commit()
    await db.close()
    return {"status": "deleted"}


@router.get("/{project_id}/stats")
async def foreshadowing_stats(project_id: str):
    """伏笔统计。"""
    db = await get_db(project_id)
    rows = await db.execute_fetchall(
        "SELECT status, COUNT(*) as count FROM foreshadowing WHERE project_id = ? GROUP BY status",
        (project_id,),
    )
    await db.close()
    return {row["status"]: row["count"] for row in rows}
