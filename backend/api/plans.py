"""执行计划 API。"""
import json
import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from db.database import get_db

router = APIRouter(prefix="/api/plans", tags=["plans"])


class UpdateStepRequest(BaseModel):
    status: str | None = None
    note: str | None = None


@router.get("/{session_id}")
async def get_plan(session_id: str):
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT * FROM execution_plans WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
            (session_id,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="执行计划不存在")
        row = dict(rows[0])
        row["plan"] = json.loads(row["plan"])
        return row
    finally:
        await db.close()


@router.get("/{project_id}/{session_id}")
async def get_project_plan(project_id: str, session_id: str):
    db = await get_db(project_id)
    try:
        rows = await db.execute_fetchall(
            "SELECT * FROM execution_plans WHERE project_id = ? AND session_id = ? ORDER BY created_at DESC LIMIT 1",
            (project_id, session_id),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="执行计划不存在")
        row = dict(rows[0])
        row["plan"] = json.loads(row["plan"])
        return row
    finally:
        await db.close()


@router.patch("/{session_id}/steps/{step_id}")
async def update_step(session_id: str, step_id: str, req: UpdateStepRequest):
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT id, plan FROM execution_plans WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
            (session_id,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="执行计划不存在")

        plan_row = dict(rows[0])
        plan = json.loads(plan_row["plan"])

        # 更新步骤状态
        if "steps" in plan:
            for step in plan["steps"]:
                if step.get("id") == step_id:
                    if req.status:
                        step["status"] = req.status
                    if req.note:
                        step["note"] = req.note
                    break

        now = int(time.time() * 1000)
        await db.execute(
            "UPDATE execution_plans SET plan = ?, updated_at = ? WHERE id = ?",
            (json.dumps(plan, ensure_ascii=False), now, plan_row["id"]),
        )
        await db.commit()
        return {"status": "updated"}
    finally:
        await db.close()


@router.patch("/{project_id}/{session_id}/steps/{step_id}")
async def update_project_step(project_id: str, session_id: str, step_id: str, req: UpdateStepRequest):
    db = await get_db(project_id)
    try:
        rows = await db.execute_fetchall(
            "SELECT id, plan FROM execution_plans WHERE project_id = ? AND session_id = ? ORDER BY created_at DESC LIMIT 1",
            (project_id, session_id),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="执行计划不存在")

        plan_row = dict(rows[0])
        plan = json.loads(plan_row["plan"])

        if "steps" in plan:
            for step in plan["steps"]:
                if step.get("id") == step_id:
                    if req.status:
                        step["status"] = req.status
                    if req.note:
                        step["note"] = req.note
                    break

        now = int(time.time() * 1000)
        await db.execute(
            "UPDATE execution_plans SET plan = ?, updated_at = ? WHERE id = ? AND project_id = ?",
            (json.dumps(plan, ensure_ascii=False), now, plan_row["id"], project_id),
        )
        await db.commit()
        return {"status": "updated"}
    finally:
        await db.close()


async def persist_execution_plan(project_id: str, session_id: str, plan: dict):
    """持久化执行计划（由 engine 调用）。"""
    db = await get_db(project_id)
    try:
        now = int(time.time() * 1000)
        await db.execute(
            "INSERT INTO execution_plans (project_id, session_id, plan, status, created_at, updated_at) VALUES (?, ?, ?, 'running', ?, ?)",
            (project_id, session_id, json.dumps(plan, ensure_ascii=False), now, now),
        )
        await db.commit()
    finally:
        await db.close()
