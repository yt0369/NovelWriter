"""
知识图谱API：节点CRUD、边CRUD、搜索、图谱获取。
"""
import json
import time
import uuid
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ai.openai_provider import OpenAIProvider
from db.database import get_db
from core.character_states import record_character_state
from core.pending_changes import FileSafetyError, resolve_project_file
from core.memory.candidates import queue_chapter_knowledge_candidates
from core.workflows.history import record_workflow_result
from core.memory.graph import (
    create_node, get_node, update_node, delete_node, list_nodes,
    create_edge, get_edges_for_node, delete_edge, get_graph,
)
from core.memory.vector_search import hybrid_search

router = APIRouter()
provider = OpenAIProvider()


# ─── 请求模型 ────────────────────────────────────────────────

class NodeCreate(BaseModel):
    name: str
    wing: str = "灵感"
    summary: str = ""
    detail: str = ""
    room: str = ""
    category: str = ""
    sub_category: str = ""
    importance: str = "normal"
    tags: list[str] = []
    metadata: dict = {}


class NodeUpdate(BaseModel):
    name: str | None = None
    wing: str | None = None
    summary: str | None = None
    detail: str | None = None
    room: str | None = None
    category: str | None = None
    sub_category: str | None = None
    importance: str | None = None
    tags: list[str] | None = None
    metadata: dict | None = None


class EdgeCreate(BaseModel):
    from_node_id: str
    to_node_id: str
    edge_type: str
    note: str = ""


class CandidateApproveResult(BaseModel):
    status: str
    candidate_id: str
    target_type: str = ""
    target_id: str = ""
    workflow_type: str = ""
    workflow_run_id: str = ""
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)


class CandidateBatchRequest(BaseModel):
    candidate_ids: list[str]


class ChapterAnalyzeRequest(BaseModel):
    path: str
    use_model: bool = True


class RecallTestRequest(BaseModel):
    query: str
    top_k: int = 5


# ─── 节点端点 ────────────────────────────────────────────────

@router.get("/{project_id}/nodes")
async def api_list_nodes(
    project_id: str,
    wing: str | None = None,
    category: str | None = None,
    limit: int = 100,
):
    db = await get_db(project_id)
    nodes = await list_nodes(db, project_id, wing=wing, category=category, limit=limit)
    await db.close()
    return nodes


@router.post("/{project_id}/nodes")
async def api_create_node(project_id: str, body: NodeCreate):
    db = await get_db(project_id)
    node = await create_node(
        db, project_id,
        name=body.name, wing=body.wing,
        summary=body.summary, detail=body.detail,
        room=body.room, category=body.category,
        sub_category=body.sub_category, importance=body.importance,
        tags=body.tags, metadata=body.metadata,
    )
    await db.close()
    return node


@router.get("/{project_id}/nodes/{node_id}")
async def api_get_node(project_id: str, node_id: str):
    db = await get_db(project_id)
    node = await get_node(db, node_id)
    await db.close()
    if not node:
        raise HTTPException(status_code=404, detail="节点不存在")
    return node


@router.patch("/{project_id}/nodes/{node_id}")
async def api_update_node(project_id: str, node_id: str, body: NodeUpdate):
    db = await get_db(project_id)
    node = await update_node(db, node_id, **body.model_dump(exclude_none=True))
    await db.close()
    if not node:
        raise HTTPException(status_code=404, detail="节点不存在")
    return node


@router.delete("/{project_id}/nodes/{node_id}")
async def api_delete_node(project_id: str, node_id: str):
    db = await get_db(project_id)
    ok = await delete_node(db, node_id)
    await db.close()
    if not ok:
        raise HTTPException(status_code=404, detail="节点不存在")
    return {"status": "deleted"}


# ─── 边端点 ──────────────────────────────────────────────────

@router.get("/{project_id}/edges")
async def api_list_edges(project_id: str, node_id: str | None = None):
    db = await get_db(project_id)
    if node_id:
        edges = await get_edges_for_node(db, node_id)
    else:
        rows = await db.execute_fetchall(
            "SELECT * FROM knowledge_edges WHERE project_id = ?", (project_id,)
        )
        edges = [dict(r) for r in rows]
    await db.close()
    return edges


@router.post("/{project_id}/edges")
async def api_create_edge(project_id: str, body: EdgeCreate):
    db = await get_db(project_id)
    edge = await create_edge(
        db, project_id,
        from_node_id=body.from_node_id,
        to_node_id=body.to_node_id,
        edge_type=body.edge_type,
        note=body.note,
    )
    await db.close()
    return edge


@router.delete("/{project_id}/edges/{edge_id}")
async def api_delete_edge(project_id: str, edge_id: str):
    db = await get_db(project_id)
    ok = await delete_edge(db, edge_id)
    await db.close()
    if not ok:
        raise HTTPException(status_code=404, detail="边不存在")
    return {"status": "deleted"}


# ─── 搜索和图谱 ─────────────────────────────────────────────

@router.get("/{project_id}/search")
async def api_search(project_id: str, query: str, top_k: int = 10, wing: str | None = None):
    db = await get_db(project_id)
    results = await hybrid_search(db, query, top_k=top_k, wing=wing)
    await db.close()
    return results


@router.get("/{project_id}/graph")
async def api_get_graph(project_id: str):
    db = await get_db(project_id)
    graph = await get_graph(db, project_id)
    await db.close()
    return graph


# ─── 待确认知识 ─────────────────────────────────────────────

@router.get("/{project_id}/candidates")
async def api_list_candidates(project_id: str, status: str = "pending"):
    db = await get_db(project_id)
    rows = await db.execute_fetchall(
        "SELECT * FROM knowledge_candidates WHERE project_id = ? AND status = ? ORDER BY created_at DESC",
        (project_id, status),
    )
    await db.close()
    result = []
    for row in rows:
        item = dict(row)
        try:
            item["payload"] = json.loads(item["payload"]) if item.get("payload") else {}
        except (json.JSONDecodeError, TypeError):
            item["payload"] = {}
        result.append(item)
    return result


@router.post("/{project_id}/analyze-chapter")
async def api_analyze_chapter(project_id: str, body: ChapterAnalyzeRequest):
    try:
        rel_path, file_path = resolve_project_file(project_id, body.path)
    except FileSafetyError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="章节文件不存在")

    content = file_path.read_text(encoding="utf-8")
    created = await queue_chapter_knowledge_candidates(
        project_id,
        rel_path,
        content,
        provider if body.use_model else None,
    )
    return await record_workflow_result(
        project_id,
        "chapter_analysis",
        "completed",
        {"path": rel_path, "use_model": body.use_model},
        {
            "source_file_path": rel_path,
            "created_candidate_ids": created,
            "extraction_mode": "model_analysis" if body.use_model and created else "local_rule",
        },
    )


@router.post("/{project_id}/candidates/{candidate_id}/approve", response_model=CandidateApproveResult)
async def api_approve_candidate(project_id: str, candidate_id: str):
    db = await get_db(project_id)
    try:
        return await _approve_candidate_with_db(db, project_id, candidate_id)
    finally:
        await db.close()


@router.post("/{project_id}/candidates/{candidate_id}/reject")
async def api_reject_candidate(project_id: str, candidate_id: str):
    db = await get_db(project_id)
    try:
        return await _reject_candidate_with_db(db, project_id, candidate_id)
    finally:
        await db.close()


@router.post("/{project_id}/candidates/batch-approve")
async def api_batch_approve_candidates(project_id: str, body: CandidateBatchRequest):
    db = await get_db(project_id)
    try:
        results = []
        for candidate_id in body.candidate_ids:
            results.append((await _approve_candidate_with_db(db, project_id, candidate_id)).model_dump())
        return {"status": "ok", "results": results}
    finally:
        await db.close()


@router.post("/{project_id}/candidates/batch-reject")
async def api_batch_reject_candidates(project_id: str, body: CandidateBatchRequest):
    db = await get_db(project_id)
    try:
        results = []
        for candidate_id in body.candidate_ids:
            try:
                results.append(await _reject_candidate_with_db(db, project_id, candidate_id))
            except HTTPException:
                results.append({"candidate_id": candidate_id, "status": "unchanged"})
        return {"status": "ok", "results": results}
    finally:
        await db.close()


@router.post("/{project_id}/candidates/batch-preview")
async def api_preview_candidate_batch(project_id: str, body: CandidateBatchRequest):
    db = await get_db(project_id)
    try:
        return await _preview_candidate_batch_with_db(db, project_id, body.candidate_ids)
    finally:
        await db.close()


async def _preview_candidate_batch_with_db(db, project_id: str, candidate_ids: list[str]) -> dict[str, Any]:
    items = []
    for candidate_id in candidate_ids:
        rows = await db.execute_fetchall(
            "SELECT * FROM knowledge_candidates WHERE project_id = ? AND id = ?",
            (project_id, candidate_id),
        )
        if not rows:
            items.append({
                "candidate_id": candidate_id,
                "status": "missing",
                "duplicate_risk": False,
                "target_type": "",
                "target_label": "",
            })
            continue
        items.append(await _preview_candidate_row(db, project_id, rows[0]))

    target_counts: dict[str, int] = {}
    duplicate_count = 0
    for item in items:
        target_type = item.get("target_type") or ""
        if target_type:
            target_counts[target_type] = target_counts.get(target_type, 0) + 1
        if item.get("duplicate_risk"):
            duplicate_count += 1

    return {
        "status": "ok",
        "items": items,
        "summary": {
            "total": len(items),
            "duplicate_count": duplicate_count,
            "target_counts": target_counts,
        },
    }


async def _preview_candidate_row(db, project_id: str, row) -> dict[str, Any]:
    try:
        payload = json.loads(row["payload"]) if row["payload"] else {}
    except (json.JSONDecodeError, TypeError):
        payload = {}
    candidate_type = row["candidate_type"] or ""
    target_type = _candidate_target_type(candidate_type, payload)
    existing_target_id = await _find_existing_candidate_target(
        db,
        project_id,
        candidate_type,
        row["source_file_path"],
        payload,
    )
    return {
        "candidate_id": row["id"],
        "candidate_type": candidate_type,
        "status": row["status"],
        "source_file_path": row["source_file_path"] or "",
        "target_type": target_type,
        "target_label": _target_label(target_type),
        "display_name": _candidate_display_name(candidate_type, payload, row["source_file_path"]),
        "summary": str(payload.get("summary") or payload.get("description") or payload.get("message") or "")[:500],
        "evidence": str(payload.get("evidence") or "")[:500],
        "confidence": payload.get("confidence"),
        "suggested_update": str(payload.get("suggested_update") or "")[:500],
        "duplicate_risk": bool(existing_target_id),
        "existing_target_id": existing_target_id,
        "duplicate_reason": _duplicate_reason(candidate_type) if existing_target_id else "",
    }


def _candidate_target_type(candidate_type: str, payload: dict[str, Any]) -> str:
    if payload.get("target_type"):
        return str(payload["target_type"])
    return {
        "chapter_summary": "chapter_summary",
        "chapter_analysis_required": "chapter_summary",
        "world_setting": "knowledge_node",
        "character_state": "character",
        "timeline_event": "timeline_event",
        "foreshadowing": "foreshadowing",
    }.get(candidate_type, "knowledge_node")


def _candidate_display_name(candidate_type: str, payload: dict[str, Any], source_file_path: str | None) -> str:
    if payload.get("title"):
        return str(payload["title"])
    if payload.get("name"):
        return str(payload["name"])
    if candidate_type in {"chapter_summary", "chapter_analysis_required"} and source_file_path:
        return source_file_path.rsplit("/", 1)[-1].replace(".md", "")
    return candidate_type or "待确认知识"


def _target_label(target_type: str) -> str:
    labels = {
        "chapter_summary": "章节摘要",
        "character": "人物档案",
        "timeline_event": "时间线事件",
        "foreshadowing": "伏笔表",
        "knowledge_node": "知识图谱",
    }
    return labels.get(target_type, target_type)


def _duplicate_reason(candidate_type: str) -> str:
    labels = {
        "chapter_summary": "同章节摘要已存在",
        "chapter_analysis_required": "同章节摘要已存在",
        "world_setting": "同名世界观/知识节点已存在",
        "character_state": "同名人物档案已存在",
        "timeline_event": "同名时间线事件已存在",
        "foreshadowing": "同名伏笔已存在",
    }
    return labels.get(candidate_type, "相似目标已存在")


async def _find_existing_candidate_target(
    db,
    project_id: str,
    candidate_type: str,
    source_file_path: str | None,
    payload: dict[str, Any],
) -> str:
    if candidate_type in {"chapter_summary", "chapter_analysis_required"}:
        file_path = source_file_path or payload.get("file_path") or ""
        if not file_path:
            return ""
        rows = await db.execute_fetchall(
            "SELECT id FROM chapter_summaries WHERE project_id = ? AND file_path = ? LIMIT 1",
            (project_id, file_path),
        )
        return rows[0]["id"] if rows else ""
    if candidate_type == "world_setting":
        return await _find_existing_by_name(
            db,
            "knowledge_nodes",
            project_id,
            payload.get("name", ""),
            "category",
            payload.get("category", "自动提取"),
        )
    if candidate_type == "character_state":
        return await _find_existing_by_name(db, "character_profiles", project_id, payload.get("name", ""))
    if candidate_type == "timeline_event":
        return await _find_existing_by_name(
            db,
            "timeline_events",
            project_id,
            payload.get("name", ""),
            "description",
            payload.get("description", ""),
        )
    if candidate_type == "foreshadowing":
        return await _find_existing_by_name(
            db,
            "foreshadowing",
            project_id,
            payload.get("name", ""),
            "description",
            payload.get("description", ""),
        )
    return ""


async def _approve_candidate_with_db(db, project_id: str, candidate_id: str) -> CandidateApproveResult:
    rows = await db.execute_fetchall(
        "SELECT * FROM knowledge_candidates WHERE project_id = ? AND id = ?",
        (project_id, candidate_id),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="候选知识不存在")
    row = rows[0]
    try:
        payload = json.loads(row["payload"]) if row["payload"] else {}
    except (json.JSONDecodeError, TypeError):
        payload = {}

    target_type = payload.get("target_type", "")
    target_id = payload.get("target_id", "")
    if row["status"] == "approved":
        result = CandidateApproveResult(
            status="approved",
            candidate_id=candidate_id,
            target_type=target_type,
            target_id=target_id,
        )
        workflow = await record_workflow_result(
            project_id,
            "knowledge_candidate_approval",
            "completed",
            {"candidate_id": candidate_id, "candidate_type": row["candidate_type"]},
            {
                "candidate_id": candidate_id,
                "target_type": target_type,
                "target_id": target_id,
                "status": "approved",
            },
        )
        result.workflow_type = workflow["workflow_type"]
        result.workflow_run_id = workflow["workflow_run_id"]
        result.input = workflow["input"]
        result.output = workflow["output"]
        return result
    if row["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"候选知识状态为 {row['status']}，不能批准")

    target_type, target_id = await _apply_candidate(db, project_id, row["candidate_type"], row["source_file_path"], payload)
    try:
        from core.chapter_tasks import handle_tasks_for_approved_candidate
        handled_task_count = await handle_tasks_for_approved_candidate(db, project_id, candidate_id)
    except ImportError:
        handled_task_count = 0
    payload["target_type"] = target_type
    payload["target_id"] = target_id
    now = int(time.time())
    await db.execute(
        "UPDATE knowledge_candidates SET payload = ?, status = 'approved', updated_at = ? WHERE project_id = ? AND id = ?",
        (json.dumps(payload, ensure_ascii=False), now, project_id, candidate_id),
    )
    await db.commit()
    workflow = await record_workflow_result(
        project_id,
        "knowledge_candidate_approval",
        "completed",
        {"candidate_id": candidate_id, "candidate_type": row["candidate_type"]},
        {
            "candidate_id": candidate_id,
            "target_type": target_type,
            "target_id": target_id,
            "status": "approved",
            "handled_chapter_tasks": handled_task_count,
        },
    )
    return CandidateApproveResult(
        status="approved",
        candidate_id=candidate_id,
        target_type=target_type,
        target_id=target_id,
        workflow_type=workflow["workflow_type"],
        workflow_run_id=workflow["workflow_run_id"],
        input=workflow["input"],
        output=workflow["output"],
    )


async def _reject_candidate_with_db(db, project_id: str, candidate_id: str):
    rows = await db.execute_fetchall(
        "SELECT * FROM knowledge_candidates WHERE project_id = ? AND id = ?",
        (project_id, candidate_id),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="候选知识不存在")
    row = rows[0]
    now = int(time.time())
    cursor = await db.execute(
        "UPDATE knowledge_candidates SET status = 'rejected', updated_at = ? WHERE project_id = ? AND id = ? AND status = 'pending'",
        (now, project_id, candidate_id),
    )
    await db.commit()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="候选知识不存在或已处理")
    return await record_workflow_result(
        project_id,
        "knowledge_candidate_reject",
        "rejected",
        {"candidate_id": candidate_id, "candidate_type": row["candidate_type"]},
        {"candidate_id": candidate_id, "status": "rejected"},
    )


async def _apply_candidate(db, project_id: str, candidate_type: str, source_file_path: str | None, payload: dict) -> tuple[str, str]:
    now = int(time.time())
    metadata = {"source_file_path": source_file_path, "candidate_type": candidate_type}

    if candidate_type in {"chapter_summary", "chapter_analysis_required"}:
        file_path = source_file_path or payload.get("file_path") or ""
        title = payload.get("title") or file_path.rsplit("/", 1)[-1].replace(".md", "") or "章节摘要"
        summary = payload.get("summary") or payload.get("message") or ""
        summary_id = str(uuid.uuid4())[:8]
        await db.execute(
            """INSERT INTO chapter_summaries (id, project_id, file_path, title, summary, characters, key_events, foreshadowing, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(project_id, file_path)
               DO UPDATE SET title = excluded.title, summary = excluded.summary, characters = excluded.characters,
                             key_events = excluded.key_events, foreshadowing = excluded.foreshadowing, updated_at = excluded.updated_at""",
            (
                summary_id,
                project_id,
                file_path,
                title,
                summary,
                json.dumps(payload.get("characters", []), ensure_ascii=False),
                json.dumps(payload.get("key_events", []), ensure_ascii=False),
                json.dumps(payload.get("foreshadowing", []), ensure_ascii=False),
                now,
                now,
            ),
        )
        node = await create_node(
            db,
            project_id,
            name=title,
            wing="剧情",
            summary=summary[:500],
            detail=json.dumps(payload, ensure_ascii=False),
            category="章节摘要",
            importance="normal",
            tags=["章节摘要"],
            metadata=metadata,
        )
        return "chapter_summary", node["id"]

    if candidate_type == "world_setting":
        existing_id = await _find_existing_by_name(db, "knowledge_nodes", project_id, payload.get("name", ""), "category", payload.get("category", "自动提取"))
        if existing_id:
            return "knowledge_node", existing_id
        node = await create_node(
            db,
            project_id,
            name=payload.get("name", "未命名设定"),
            wing=payload.get("wing", "世界"),
            summary=payload.get("summary", ""),
            detail=payload.get("detail", payload.get("description", "")),
            category=payload.get("category", "自动提取"),
            importance=payload.get("importance", "normal"),
            tags=payload.get("tags", ["设定"]),
            metadata=metadata,
        )
        return "knowledge_node", node["id"]

    if candidate_type == "character_state":
        existing_id = await _find_existing_by_name(db, "character_profiles", project_id, payload.get("name", ""))
        name = payload.get("name", "未命名角色")
        if existing_id:
            await record_character_state(db, project_id, existing_id, name, source_file_path or payload.get("file_path", ""), payload)
            return "character", existing_id
        char_id = str(uuid.uuid4())[:8]
        await db.execute(
            """INSERT INTO character_profiles (id, project_id, name, aliases, role, profile_data, file_path, created_at, last_modified)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                char_id,
                project_id,
                name,
                payload.get("aliases"),
                payload.get("role", "自动提取"),
                json.dumps(payload, ensure_ascii=False),
                payload.get("file_path"),
                now,
                now,
            ),
        )
        await record_character_state(db, project_id, char_id, name, source_file_path or payload.get("file_path", ""), payload)
        return "character", char_id

    if candidate_type == "timeline_event":
        existing_id = await _find_existing_by_name(db, "timeline_events", project_id, payload.get("name", ""), "description", payload.get("description", ""))
        if existing_id:
            return "timeline_event", existing_id
        event_id = str(uuid.uuid4())[:8]
        await db.execute(
            """INSERT INTO timeline_events (id, chapter_id, project_id, name, description, day, hour, story_line_id, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                event_id,
                payload.get("chapter_id"),
                project_id,
                payload.get("name", "未命名事件"),
                payload.get("description", ""),
                payload.get("day"),
                payload.get("hour"),
                payload.get("story_line_id"),
                payload.get("status", "planned"),
                now,
            ),
        )
        return "timeline_event", event_id

    if candidate_type == "foreshadowing":
        existing_id = await _find_existing_by_name(db, "foreshadowing", project_id, payload.get("name", ""), "description", payload.get("description", ""))
        if existing_id:
            return "foreshadowing", existing_id
        fs_id = str(uuid.uuid4())[:8]
        await db.execute(
            """INSERT INTO foreshadowing (id, project_id, name, description, plant_chapter_id, resolve_chapter_id, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                fs_id,
                project_id,
                payload.get("name", "未命名伏笔"),
                payload.get("description", ""),
                payload.get("plant_chapter_id"),
                payload.get("resolve_chapter_id"),
                payload.get("status", "planted"),
                now,
            ),
        )
        return "foreshadowing", fs_id

    node = await create_node(
        db,
        project_id,
        name=payload.get("name", candidate_type or "待确认知识"),
        wing=payload.get("wing", "灵感"),
        summary=payload.get("summary", json.dumps(payload, ensure_ascii=False)[:500]),
        detail=json.dumps(payload, ensure_ascii=False),
        category=candidate_type or "自动提取",
        importance=payload.get("importance", "normal"),
        tags=payload.get("tags", ["自动提取"]),
        metadata=metadata,
    )
    return "knowledge_node", node["id"]


async def _find_existing_by_name(
    db,
    table: str,
    project_id: str,
    name: str,
    extra_field: str | None = None,
    extra_value: str | None = None,
) -> str:
    allowed_tables = {"knowledge_nodes", "character_profiles", "timeline_events", "foreshadowing"}
    allowed_fields = {"category", "description"}
    clean_name = (name or "").strip()
    if table not in allowed_tables or not clean_name:
        return ""
    sql = f"SELECT id FROM {table} WHERE project_id = ? AND name = ?"
    params: list[Any] = [project_id, clean_name]
    if extra_field in allowed_fields and extra_value:
        sql += f" AND {extra_field} = ?"
        params.append(extra_value)
    sql += " LIMIT 1"
    rows = await db.execute_fetchall(sql, params)
    return rows[0]["id"] if rows else ""


# ─── 跨项目共享知识 ────────────────────────────────────────────

class SharedPromote(BaseModel):
    name: str
    summary: str
    detail: str = ""
    category: str = ""
    source_node_id: str = ""
    tags: list[str] = []


@router.post("/{project_id}/shared/promote")
async def api_promote_to_shared(project_id: str, body: SharedPromote):
    """将项目知识提升为跨项目共享知识。"""
    from core.memory.evolutionary import promote_to_shared
    db = await get_db(None)  # 共享数据库
    result = await promote_to_shared(
        db, name=body.name, summary=body.summary, detail=body.detail,
        category=body.category, source_project_id=project_id,
        source_node_id=body.source_node_id, tags=body.tags,
    )
    await db.close()
    return result


@router.get("/shared/search")
async def api_search_shared(query: str, top_k: int = 5):
    """搜索跨项目共享知识。"""
    from core.memory.evolutionary import search_shared
    db = await get_db(None)
    results = await search_shared(db, query, top_k=top_k)
    await db.close()
    return results


@router.get("/shared/list")
async def api_list_shared(category: str | None = None, limit: int = 50):
    """列出共享知识。"""
    from core.memory.evolutionary import list_shared
    db = await get_db(None)
    results = await list_shared(db, category=category, limit=limit)
    await db.close()
    return results


@router.delete("/shared/{node_id}")
async def api_delete_shared(node_id: str):
    """删除共享知识。"""
    from core.memory.evolutionary import delete_shared
    db = await get_db(None)
    ok = await delete_shared(db, node_id)
    await db.close()
    if not ok:
        raise HTTPException(status_code=404, detail="共享知识不存在")
    return {"status": "deleted"}


# ─── 嵌入健康检查 (7.1-7.2) ──────────────────────────────────

@router.get("/{project_id}/embedding-status")
async def embedding_status(project_id: str):
    from core.memory.embedding_health import check_embedding_health
    return await check_embedding_health(project_id)


@router.post("/{project_id}/embedding-repair")
async def embedding_repair(project_id: str):
    from core.memory.embedding_health import repair_embeddings
    return await repair_embeddings(project_id)


@router.get("/{project_id}/embedding-stats")
async def embedding_stats(project_id: str):
    from core.memory.embedding_health import get_embedding_stats
    return await get_embedding_stats(project_id)


@router.post("/{project_id}/test-recall")
async def test_recall(project_id: str, req: RecallTestRequest):
    started = time.perf_counter()
    db = await get_db(project_id)
    try:
        results = await hybrid_search(db, req.query, top_k=req.top_k)
    finally:
        await db.close()
    latency_ms = int((time.perf_counter() - started) * 1000)
    return {
        "query": req.query,
        "latency_ms": latency_ms,
        "results": [
            {
                "id": item.get("id", ""),
                "name": item.get("name", ""),
                "score": item.get("score", 0),
                "wing": item.get("wing", ""),
            }
            for item in results
        ],
    }
