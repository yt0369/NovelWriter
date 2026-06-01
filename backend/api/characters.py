"""
角色档案API：CRUD + 版本历史。
"""
import json
import time
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.character_states import list_character_state_history as list_state_history
from db.database import get_db

router = APIRouter()


class CharacterCreate(BaseModel):
    name: str
    aliases: str = ""
    role: str = ""
    profile_data: dict = {}
    file_path: str = ""


class CharacterUpdate(BaseModel):
    name: str | None = None
    aliases: str | None = None
    role: str | None = None
    profile_data: dict | None = None
    file_path: str | None = None


@router.get("/{project_id}")
async def list_characters(project_id: str):
    db = await get_db(project_id)
    rows = await db.execute_fetchall(
        "SELECT * FROM character_profiles WHERE project_id = ? ORDER BY name",
        (project_id,),
    )
    await db.close()
    result = []
    for r in rows:
        d = dict(r)
        d["profile_data"] = json.loads(d["profile_data"]) if d["profile_data"] else {}
        result.append(d)
    return result


@router.post("/{project_id}")
async def create_character(project_id: str, body: CharacterCreate):
    cid = str(uuid.uuid4())[:8]
    now = int(time.time())
    db = await get_db(project_id)
    await db.execute(
        "INSERT INTO character_profiles (id, project_id, name, aliases, role, profile_data, file_path, created_at, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (cid, project_id, body.name, body.aliases, body.role, json.dumps(body.profile_data, ensure_ascii=False), body.file_path, now, now),
    )
    await db.commit()
    await db.close()
    return {"id": cid, "name": body.name}


@router.get("/{project_id}/{character_id}/states")
async def list_character_state_history(project_id: str, character_id: str, limit: int = 50):
    db = await get_db(project_id)
    try:
        return await list_state_history(db, project_id, character_id, limit)
    finally:
        await db.close()


@router.get("/{project_id}/{character_id}")
async def get_character(project_id: str, character_id: str):
    db = await get_db(project_id)
    rows = await db.execute_fetchall(
        "SELECT * FROM character_profiles WHERE id = ?", (character_id,)
    )
    await db.close()
    if not rows:
        raise HTTPException(status_code=404, detail="角色不存在")
    d = dict(rows[0])
    d["profile_data"] = json.loads(d["profile_data"]) if d["profile_data"] else {}
    return d


@router.patch("/{project_id}/{character_id}")
async def update_character(project_id: str, character_id: str, body: CharacterUpdate):
    db = await get_db(project_id)
    updates = {}
    for k, v in body.model_dump(exclude_none=True).items():
        if k == "profile_data":
            updates[k] = json.dumps(v, ensure_ascii=False)
        else:
            updates[k] = v
    if updates:
        updates["last_modified"] = int(time.time())
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        await db.execute(f"UPDATE character_profiles SET {set_clause} WHERE id = ?", list(updates.values()) + [character_id])
        await db.commit()
    await db.close()
    return {"status": "updated"}


@router.delete("/{project_id}/{character_id}")
async def delete_character(project_id: str, character_id: str):
    db = await get_db(project_id)
    await db.execute("DELETE FROM character_profiles WHERE id = ?", (character_id,))
    await db.commit()
    await db.close()
    return {"status": "deleted"}
