"""
进化记忆系统：跨项目知识共享与学习。
允许将项目内的知识节点提升为全局共享知识，
在新项目中自动关联相关经验。
"""
import json
import time
import uuid
from typing import Any

import aiosqlite

from core.memory.embeddings import embed_text, cosine_similarity


async def promote_to_shared(
    db: aiosqlite.Connection,
    name: str,
    summary: str,
    detail: str = "",
    category: str = "",
    source_project_id: str = "",
    source_node_id: str = "",
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """将知识提升为跨项目共享知识。"""
    node_id = str(uuid.uuid4())[:8]
    now = int(time.time())

    embedding = embed_text(f"{name} {summary} {detail}")

    await db.execute(
        """INSERT INTO shared_knowledge
        (id, name, summary, detail, category, source_project_id, source_node_id,
         embedding, tags, created_at, last_modified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (node_id, name, summary, detail, category, source_project_id, source_node_id,
         json.dumps(embedding), json.dumps(tags or [], ensure_ascii=False), now, now),
    )
    await db.commit()

    return {
        "id": node_id, "name": name, "summary": summary, "detail": detail,
        "category": category, "source_project_id": source_project_id,
        "tags": tags or [], "created_at": now,
    }


async def search_shared(
    db: aiosqlite.Connection,
    query: str,
    top_k: int = 5,
) -> list[dict[str, Any]]:
    """语义搜索共享知识。"""
    query_embedding = embed_text(query)

    rows = await db.execute_fetchall(
        "SELECT * FROM shared_knowledge ORDER BY created_at DESC LIMIT 100"
    )

    results = []
    for r in rows:
        node_embedding = json.loads(r["embedding"]) if r["embedding"] else []
        if node_embedding:
            sim = cosine_similarity(query_embedding, node_embedding)
        else:
            sim = 0.0
        results.append({
            "id": r["id"], "name": r["name"], "summary": r["summary"],
            "detail": r["detail"], "category": r["category"],
            "source_project_id": r["source_project_id"],
            "tags": json.loads(r["tags"]) if r["tags"] else [],
            "similarity": round(sim, 4),
        })

    results.sort(key=lambda x: x["similarity"], reverse=True)
    return results[:top_k]


async def list_shared(
    db: aiosqlite.Connection,
    category: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """列出共享知识。"""
    if category:
        rows = await db.execute_fetchall(
            "SELECT * FROM shared_knowledge WHERE category = ? ORDER BY last_modified DESC LIMIT ?",
            (category, limit),
        )
    else:
        rows = await db.execute_fetchall(
            "SELECT * FROM shared_knowledge ORDER BY last_modified DESC LIMIT ?",
            (limit,),
        )

    return [{
        "id": r["id"], "name": r["name"], "summary": r["summary"],
        "detail": r["detail"], "category": r["category"],
        "source_project_id": r["source_project_id"],
        "tags": json.loads(r["tags"]) if r["tags"] else [],
        "created_at": r["created_at"], "last_modified": r["last_modified"],
    } for r in rows]


async def delete_shared(db: aiosqlite.Connection, node_id: str) -> bool:
    """删除共享知识。"""
    cursor = await db.execute("DELETE FROM shared_knowledge WHERE id = ?", (node_id,))
    await db.commit()
    return cursor.rowcount > 0


async def get_shared_context(db: aiosqlite.Connection, query: str) -> str:
    """获取与查询相关的共享知识上下文，用于注入系统提示词。"""
    results = await search_shared(db, query, top_k=3)
    if not results:
        return ""

    parts = ["[跨项目经验]"]
    for r in results:
        if r["similarity"] > 0.3:
            parts.append(f"- {r['name']}: {r['summary']}")
    return "\n".join(parts) if len(parts) > 1 else ""
