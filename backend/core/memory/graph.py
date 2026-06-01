"""
知识图谱CRUD操作：节点、边
"""
import json
import time
import uuid
from typing import Any

import aiosqlite

from core.memory.embeddings import embed_text


# ─── 节点 CRUD ──────────────────────────────────────────────

async def create_node(
    db: aiosqlite.Connection,
    project_id: str,
    name: str,
    wing: str,
    summary: str = "",
    detail: str = "",
    room: str = "",
    category: str = "",
    sub_category: str = "",
    importance: str = "normal",
    tags: list[str] | None = None,
    metadata: dict | None = None,
) -> dict[str, Any]:
    """创建知识节点，自动生成embedding（如果可用）。"""
    node_id = str(uuid.uuid4())[:8]
    now = int(time.time())

    # 生成embedding（可选）
    emb_text = f"{name} {summary} {detail}"
    try:
        embedding = embed_text(emb_text)
    except (ImportError, Exception):
        embedding = []

    await db.execute(
        """INSERT INTO knowledge_nodes
        (id, project_id, name, summary, detail, wing, room, category, sub_category,
         importance, tags, embedding, metadata, created_at, last_modified, accessed_at, access_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
        (
            node_id, project_id, name, summary, detail, wing, room,
            category, sub_category, importance,
            json.dumps(tags or [], ensure_ascii=False),
            json.dumps(embedding),
            json.dumps(metadata or {}, ensure_ascii=False),
            now, now, now,
        ),
    )
    await db.commit()

    return {
        "id": node_id, "name": name, "summary": summary, "detail": detail,
        "wing": wing, "room": room, "category": category, "sub_category": sub_category,
        "importance": importance, "tags": tags or [], "metadata": metadata or {},
        "created_at": now, "last_modified": now,
    }


async def get_node(db: aiosqlite.Connection, node_id: str) -> dict[str, Any] | None:
    """获取单个节点。"""
    row = await db.execute_fetchall(
        "SELECT * FROM knowledge_nodes WHERE id = ?", (node_id,)
    )
    if not row:
        return None
    r = row[0]
    # 更新访问时间和次数
    await db.execute(
        "UPDATE knowledge_nodes SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?",
        (int(time.time()), node_id),
    )
    await db.commit()
    return _row_to_node(r)


async def update_node(
    db: aiosqlite.Connection,
    node_id: str,
    **kwargs,
) -> dict[str, Any] | None:
    """更新节点字段。"""
    allowed = {"name", "summary", "detail", "wing", "room", "category", "sub_category", "importance", "tags", "metadata"}
    updates = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
    if not updates:
        return await get_node(db, node_id)

    # 如果更新了文本字段，重新生成embedding（可选）
    if any(k in updates for k in ("name", "summary", "detail")):
        current = await get_node(db, node_id)
        if current:
            name = updates.get("name", current["name"])
            summary = updates.get("summary", current["summary"])
            detail = updates.get("detail", current.get("detail", ""))
            try:
                embedding = embed_text(f"{name} {summary} {detail}")
                updates["embedding"] = json.dumps(embedding)
            except (ImportError, Exception):
                pass

    if "tags" in updates and isinstance(updates["tags"], list):
        updates["tags"] = json.dumps(updates["tags"], ensure_ascii=False)
    if "metadata" in updates and isinstance(updates["metadata"], dict):
        updates["metadata"] = json.dumps(updates["metadata"], ensure_ascii=False)

    updates["last_modified"] = int(time.time())
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [node_id]
    await db.execute(f"UPDATE knowledge_nodes SET {set_clause} WHERE id = ?", values)
    await db.commit()

    return await get_node(db, node_id)


async def delete_node(db: aiosqlite.Connection, node_id: str) -> bool:
    """删除节点及其关联边。"""
    await db.execute("DELETE FROM knowledge_edges WHERE from_node_id = ? OR to_node_id = ?", (node_id, node_id))
    cursor = await db.execute("DELETE FROM knowledge_nodes WHERE id = ?", (node_id,))
    await db.commit()
    return cursor.rowcount > 0


async def list_nodes(
    db: aiosqlite.Connection,
    project_id: str,
    wing: str | None = None,
    category: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """列出节点。"""
    sql = "SELECT * FROM knowledge_nodes WHERE project_id = ?"
    params: list = [project_id]
    if wing:
        sql += " AND wing = ?"
        params.append(wing)
    if category:
        sql += " AND category = ?"
        params.append(category)
    sql += " ORDER BY last_modified DESC LIMIT ?"
    params.append(limit)

    rows = await db.execute_fetchall(sql, params)
    return [_row_to_node(r) for r in rows]


def _row_to_node(r) -> dict[str, Any]:
    tags = json.loads(r["tags"]) if r["tags"] else []
    metadata = json.loads(r["metadata"]) if r["metadata"] else {}
    return {
        "id": r["id"], "project_id": r["project_id"],
        "name": r["name"], "summary": r["summary"], "detail": r["detail"],
        "wing": r["wing"], "room": r["room"],
        "category": r["category"], "sub_category": r["sub_category"],
        "importance": r["importance"], "tags": tags, "metadata": metadata,
        "created_at": r["created_at"], "last_modified": r["last_modified"],
        "accessed_at": r["accessed_at"], "access_count": r["access_count"],
    }


# ─── 边 CRUD ────────────────────────────────────────────────

async def create_edge(
    db: aiosqlite.Connection,
    project_id: str,
    from_node_id: str,
    to_node_id: str,
    edge_type: str,
    note: str = "",
) -> dict[str, Any]:
    """创建节点间的关系边。"""
    edge_id = str(uuid.uuid4())[:8]
    now = int(time.time())
    await db.execute(
        "INSERT INTO knowledge_edges (id, project_id, from_node_id, to_node_id, edge_type, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (edge_id, project_id, from_node_id, to_node_id, edge_type, note, now),
    )
    await db.commit()
    return {"id": edge_id, "from_node_id": from_node_id, "to_node_id": to_node_id, "edge_type": edge_type, "note": note, "created_at": now}


async def get_edges_for_node(db: aiosqlite.Connection, node_id: str) -> list[dict[str, Any]]:
    """获取节点的所有关联边。"""
    rows = await db.execute_fetchall(
        "SELECT * FROM knowledge_edges WHERE from_node_id = ? OR to_node_id = ?",
        (node_id, node_id),
    )
    return [dict(r) for r in rows]


async def delete_edge(db: aiosqlite.Connection, edge_id: str) -> bool:
    """删除边。"""
    cursor = await db.execute("DELETE FROM knowledge_edges WHERE id = ?", (edge_id,))
    await db.commit()
    return cursor.rowcount > 0


async def get_graph(db: aiosqlite.Connection, project_id: str) -> dict[str, Any]:
    """获取整个知识图谱（节点+边）。"""
    nodes = await list_nodes(db, project_id, limit=500)
    rows = await db.execute_fetchall(
        "SELECT * FROM knowledge_edges WHERE project_id = ?", (project_id,)
    )
    edges = [dict(r) for r in rows]
    return {"nodes": nodes, "edges": edges}
