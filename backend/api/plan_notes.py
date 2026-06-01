"""
计划笔记 API：结构化计划的查询和审批。
"""
import json
import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from db.database import get_db

router = APIRouter(prefix="/api/plan-notes", tags=["plan_notes"])


class RejectRequest(BaseModel):
    feedback: str = ""


@router.get("/{project_id}")
async def get_plan_note(project_id: str):
    """获取当前项目的最新计划笔记。"""
    db = await get_db(project_id)
    try:
        rows = await db.execute_fetchall(
            "SELECT * FROM plan_notes WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
            (project_id,),
        )
        if not rows:
            return {"plan": None}

        plan = dict(rows[0])
        plan_id = plan["id"]

        lines = await db.execute_fetchall(
            "SELECT * FROM plan_note_lines WHERE plan_id = ? ORDER BY order_index",
            (plan_id,),
        )
        plan["lines"] = [dict(l) for l in lines]

        annotations = await db.execute_fetchall(
            "SELECT * FROM plan_note_annotations WHERE plan_id = ?",
            (plan_id,),
        )
        plan["annotations"] = [dict(a) for a in annotations]

        return {"plan": plan}
    finally:
        await db.close()


@router.post("/{plan_id}/approve")
async def approve_plan_note(plan_id: str):
    """批准计划笔记。"""
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT id, status FROM plan_notes WHERE id = ?",
            (plan_id,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="计划不存在")
        if rows[0]["status"] != "draft":
            raise HTTPException(status_code=400, detail=f"计划状态为 {rows[0]['status']}，无法批准")

        now = int(time.time())
        await db.execute(
            "UPDATE plan_notes SET status = 'approved', updated_at = ? WHERE id = ?",
            (now, plan_id),
        )
        await db.commit()
        return {"status": "approved", "plan_id": plan_id}
    finally:
        await db.close()


@router.post("/{plan_id}/reject")
async def reject_plan_note(plan_id: str, req: RejectRequest):
    """拒绝计划笔记（要求修改）。"""
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT id, status FROM plan_notes WHERE id = ?",
            (plan_id,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="计划不存在")
        if rows[0]["status"] != "draft":
            raise HTTPException(status_code=400, detail=f"计划状态为 {rows[0]['status']}，无法拒绝")

        now = int(time.time())
        await db.execute(
            "UPDATE plan_notes SET status = 'rejected', updated_at = ? WHERE id = ?",
            (now, plan_id),
        )
        await db.commit()
        return {"status": "rejected", "plan_id": plan_id, "feedback": req.feedback}
    finally:
        await db.close()
