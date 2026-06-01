"""
技能API：列出技能、激活/休眠技能。
"""
from fastapi import APIRouter, Query
from pydantic import BaseModel

from db.database import get_db
from core.presets.context import preset_context_enabled, project_preset_id
from core.skills.registry import (
    get_all_skills, get_active_skills, activate_skill, deactivate_skill,
)
from core.skills.assets import list_skill_assets, ASSETS_DIR
import time
import uuid

router = APIRouter()


class SkillAction(BaseModel):
    skill_name: str
    action: str = "activate"  # activate / deactivate


@router.get("/")
async def list_skills():
    """列出所有技能及激活状态。"""
    skills = get_all_skills()
    active_names = {a.skill.name for a in get_active_skills()}
    return [
        {
            "name": s.name,
            "display_name": s.display_name,
            "description": s.description,
            "keywords": s.keywords,
            "tools": s.tools,
            "wing": s.wing,
            "category": s.category,
            "asset_path": s.asset_path,
            "active": s.name in active_names,
        }
        for s in skills
    ]


@router.get("/asset-content")
async def read_skill_asset(path: str = Query(...)):
    """读取技能资产文件内容。"""
    import re
    safe = path.replace("\\", "/").lstrip("/")
    if safe.startswith("/") or re.match(r"^[A-Za-z]:", safe):
        return {"error": "非法路径"}
    target = (ASSETS_DIR / safe).resolve()
    if not str(target).startswith(str(ASSETS_DIR.resolve())):
        return {"error": "路径越界"}
    if not target.is_file():
        return {"error": "文件不存在"}
    return {"content": target.read_text(encoding="utf-8")}


@router.get("/{project_id}/assets")
async def get_skill_assets(project_id: str):
    """列出已迁移的技能资产，并标注项目题材匹配状态。"""
    primary_preset = await project_preset_id(project_id)
    primary_enabled = await preset_context_enabled(project_id, primary_preset) if primary_preset else False
    result = []
    for asset in list_skill_assets():
        preset = asset.get("preset", "")
        is_preset_asset = bool(preset)
        matches = bool(is_preset_asset and preset == primary_preset)
        item = {
            **asset,
            "is_preset_asset": is_preset_asset,
            "matches_project_preset": matches,
            "project_preset_id": primary_preset or None,
            "project_enabled": (primary_enabled if matches else not is_preset_asset),
            "can_be_creative_reference": bool(is_preset_asset and not matches),
        }
        result.append(item)
    return result


@router.post("/toggle")
async def toggle_skill(body: SkillAction):
    """激活或休眠技能。"""
    if body.action == "activate":
        skill = activate_skill(body.skill_name)
        if not skill:
            return {"error": f"技能不存在: {body.skill_name}"}
        return {"status": "activated", "skill": skill.name}
    elif body.action == "deactivate":
        deactivate_skill(body.skill_name)
        return {"status": "deactivated", "skill": body.skill_name}
    return {"error": f"未知操作: {body.action}"}


@router.post("/{project_id}/activate")
async def activate_project_skill(project_id: str, body: SkillAction):
    skill = activate_skill(body.skill_name)
    if not skill:
        return {"error": f"技能不存在: {body.skill_name}"}
    await _set_project_skill(project_id, body.skill_name, True, "manual")
    return {"status": "activated", "skill": skill.name}


@router.post("/{project_id}/deactivate")
async def deactivate_project_skill(project_id: str, body: SkillAction):
    deactivate_skill(body.skill_name)
    await _set_project_skill(project_id, body.skill_name, False, "manual")
    return {"status": "deactivated", "skill": body.skill_name}


async def _set_project_skill(project_id: str, skill_id: str, enabled: bool, source: str):
    now = int(time.time())
    db = await get_db(project_id)
    try:
        await db.execute(
            """INSERT INTO project_skill_settings (id, project_id, skill_id, enabled, source, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(project_id, skill_id)
               DO UPDATE SET enabled = excluded.enabled, source = excluded.source, updated_at = excluded.updated_at""",
            (str(uuid.uuid4())[:8], project_id, skill_id, 1 if enabled else 0, source, now, now),
        )
        await db.commit()
    finally:
        await db.close()
