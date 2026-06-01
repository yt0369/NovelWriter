"""实体版本历史 API。"""
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from db.database import get_db

router = APIRouter(prefix="/api/entities", tags=["entity_versions"])


class CreateVersionRequest(BaseModel):
    snapshot: dict
    change_summary: str = ""


@router.get("/{entity_type}/{entity_id}/versions")
async def list_versions(entity_type: str, entity_id: str):
    db = await get_db(entity_id)
    rows = await db.execute_fetchall(
        "SELECT * FROM entity_versions WHERE entity_type = ? AND entity_id = ? ORDER BY version DESC",
        (entity_type, entity_id),
    )
    return [dict(r) for r in (rows or [])]


@router.get("/{entity_type}/{entity_id}/versions/{version}")
async def get_version(entity_type: str, entity_id: str, version: int):
    db = await get_db(entity_id)
    row = await db.execute_fetchall(
        "SELECT * FROM entity_versions WHERE entity_type = ? AND entity_id = ? AND version = ?",
        (entity_type, entity_id, version),
    )
    if not row:
        raise HTTPException(status_code=404, detail="版本不存在")
    return dict(row[0])


@router.post("/{entity_type}/{entity_id}/versions")
async def create_version(entity_type: str, entity_id: str, req: CreateVersionRequest):
    db = await get_db(entity_id)
    # 获取当前最大版本号
    row = await db.execute_fetchall(
        "SELECT MAX(version) as max_ver FROM entity_versions WHERE entity_type = ? AND entity_id = ?",
        (entity_type, entity_id),
    )
    max_ver = dict(row[0])["max_ver"] if row and row[0] else 0
    new_version = (max_ver or 0) + 1

    import time
    now = int(time.time())
    await db.execute(
        "INSERT INTO entity_versions (entity_type, entity_id, version, snapshot, change_summary, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (entity_type, entity_id, new_version, json.dumps(req.snapshot, ensure_ascii=False), req.change_summary, now),
    )
    await db.commit()
    return {"version": new_version, "status": "created"}


@router.post("/{entity_type}/{entity_id}/versions/{version}/restore")
async def restore_version(entity_type: str, entity_id: str, version: int):
    db = await get_db(entity_id)
    row = await db.execute_fetchall(
        "SELECT snapshot FROM entity_versions WHERE entity_type = ? AND entity_id = ? AND version = ?",
        (entity_type, entity_id, version),
    )
    if not row:
        raise HTTPException(status_code=404, detail="版本不存在")
    snapshot = json.loads(dict(row[0])["snapshot"])
    return {"snapshot": snapshot, "version": version}
