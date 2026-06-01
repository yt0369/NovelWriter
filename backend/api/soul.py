"""
灵魂管理API：全局灵魂设定 + 项目级Soul编辑。
"""
import json
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import settings
from db.database import get_db

router = APIRouter()


class SoulUpdate(BaseModel):
    key: str
    value: str


class ProjectSoulUpdate(BaseModel):
    content: str


# ─── 全局 Soul ──────────────────────────────────────────────

@router.get("/")
async def list_soul():
    """获取所有全局灵魂设定。"""
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM global_settings WHERE key LIKE 'soul_%' ORDER BY key"
    )
    await db.close()
    result = {row["key"].replace("soul_", ""): row["value"] for row in rows}
    # 兼容前端：同时返回 soul 和 content 字段
    if "content" in result:
        result["soul"] = result["content"]
        result["global_soul"] = result["content"]
    return result


@router.put("/")
async def update_soul(body: SoulUpdate):
    """更新全局灵魂设定。"""
    db = await get_db()
    now = int(time.time())
    await db.execute(
        "INSERT OR REPLACE INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)",
        (f"soul_{body.key}", body.value, now),
    )
    await db.commit()
    await db.close()
    return {"status": "updated", "key": body.key}


@router.delete("/{key}")
async def delete_soul(key: str):
    """删除全局灵魂设定。"""
    db = await get_db()
    await db.execute("DELETE FROM global_settings WHERE key = ?", (f"soul_{key}",))
    await db.commit()
    await db.close()
    return {"status": "deleted"}


# ─── 项目级 Soul ────────────────────────────────────────────

SOUL_TEMPLATE = """# 项目 Soul

## 核心主题
（这个故事的核心是什么？想要传达什么？）

## 主角灵魂
（主角的核心驱动力、内心矛盾、成长方向）

## 世界观灵魂
（这个世界的独特之处、核心规则、氛围基调）

## 文风灵魂
（叙述风格、语言特色、节奏偏好）
"""


@router.get("/{project_id}/soul")
async def get_project_soul(project_id: str):
    """获取项目级Soul内容。"""
    soul_path = settings.projects_dir / project_id / "规范" / "项目Soul.md"
    if soul_path.exists():
        content = soul_path.read_text(encoding="utf-8")
    else:
        content = SOUL_TEMPLATE
    return {"content": content, "exists": soul_path.exists()}


@router.put("/{project_id}/soul")
async def update_project_soul(project_id: str, body: ProjectSoulUpdate):
    """更新项目级Soul。"""
    soul_path = settings.projects_dir / project_id / "规范" / "项目Soul.md"
    soul_path.parent.mkdir(parents=True, exist_ok=True)
    soul_path.write_text(body.content, encoding="utf-8")
    return {"status": "updated"}


@router.post("/{project_id}/soul/template")
async def reset_project_soul(project_id: str):
    """重置项目Soul为默认模板。"""
    soul_path = settings.projects_dir / project_id / "规范" / "项目Soul.md"
    soul_path.parent.mkdir(parents=True, exist_ok=True)
    soul_path.write_text(SOUL_TEMPLATE, encoding="utf-8")
    return {"status": "reset", "content": SOUL_TEMPLATE}
