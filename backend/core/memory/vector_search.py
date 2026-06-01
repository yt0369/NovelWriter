"""
向量搜索 + 混合搜索（语义 + rapidfuzz 模糊匹配）
"""
import json
from typing import Any

import aiosqlite

from core.memory.embeddings import embed_text, cosine_similarity


async def vector_search(
    db: aiosqlite.Connection,
    query_embedding: list[float],
    top_k: int = 10,
    wing: str | None = None,
) -> list[dict[str, Any]]:
    """向量搜索：加载所有节点的embedding，计算余弦相似度。"""
    sql = "SELECT id, name, summary, wing, room, category, importance, metadata, last_modified, embedding FROM knowledge_nodes WHERE embedding IS NOT NULL"
    params: list = []
    if wing:
        sql += " AND wing = ?"
        params.append(wing)

    rows = await db.execute_fetchall(sql, params)
    results = []
    for row in rows:
        emb_bytes = row["embedding"]
        if not emb_bytes:
            continue
        emb = json.loads(emb_bytes) if isinstance(emb_bytes, str) else list(emb_bytes)
        # 如果embedding是bytes格式（numpy tobytes），需要反序列化
        if isinstance(emb_bytes, bytes) and not isinstance(emb, list):
            import numpy as np
            emb = np.frombuffer(emb_bytes, dtype=np.float32).tolist()

        score = cosine_similarity(query_embedding, emb)
        results.append({
            "id": row["id"],
            "name": row["name"],
            "summary": row["summary"],
            "wing": row["wing"],
            "room": row["room"],
            "category": row["category"],
            "importance": row["importance"],
            "source": "knowledge_nodes",
            "last_modified": row["last_modified"],
            "file_path": _metadata_file_path(row["metadata"]),
            "score": round(score, 4),
        })

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]


async def fuzzy_search(
    db: aiosqlite.Connection,
    query: str,
    top_k: int = 10,
    wing: str | None = None,
) -> list[dict[str, Any]]:
    """模糊搜索：使用SQL LIKE + rapidfuzz排序。"""
    sql = "SELECT id, name, summary, wing, room, category, importance, metadata, last_modified FROM knowledge_nodes WHERE (name LIKE ? OR summary LIKE ? OR detail LIKE ?)"
    like_q = f"%{query}%"
    params: list = [like_q, like_q, like_q]
    if wing:
        sql += " AND wing = ?"
        params.append(wing)

    rows = await db.execute_fetchall(sql, params)

    try:
        from rapidfuzz import fuzz
        results = []
        for row in rows:
            name_score = fuzz.partial_ratio(query, row["name"] or "")
            summary_score = fuzz.partial_ratio(query, row["summary"] or "") * 0.6
            score = max(name_score, summary_score) / 100.0
            results.append({
                "id": row["id"],
                "name": row["name"],
                "summary": row["summary"],
                "wing": row["wing"],
                "room": row["room"],
                "category": row["category"],
                "importance": row["importance"],
                "source": "knowledge_nodes",
                "last_modified": row["last_modified"],
                "file_path": _metadata_file_path(row["metadata"]),
                "score": round(score, 4),
            })
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]
    except ImportError:
        # rapidfuzz未安装，使用简单匹配
        return [{
            "id": row["id"],
            "name": row["name"],
            "summary": row["summary"],
            "wing": row["wing"],
            "room": row["room"],
            "category": row["category"],
            "importance": row["importance"],
            "source": "knowledge_nodes",
            "last_modified": row["last_modified"],
            "file_path": _metadata_file_path(row["metadata"]),
            "score": 0.5,
        } for row in rows[:top_k]]


async def hybrid_search(
    db: aiosqlite.Connection,
    query: str,
    top_k: int = 10,
    wing: str | None = None,
    semantic_weight: float = 0.6,
) -> list[dict[str, Any]]:
    """混合搜索：语义搜索 + 模糊搜索，加权合并。"""
    # 并行执行两种搜索
    query_embedding = embed_text(query)

    vec_results = await vector_search(db, query_embedding, top_k=top_k * 2, wing=wing)
    fuzzy_results = await fuzzy_search(db, query, top_k=top_k * 2, wing=wing)

    # 合并结果，按id去重，加权得分
    merged: dict[str, dict] = {}

    for r in vec_results:
        rid = r["id"]
        merged[rid] = {**r, "score": r["score"] * semantic_weight}

    for r in fuzzy_results:
        rid = r["id"]
        if rid in merged:
            merged[rid]["score"] += r["score"] * (1 - semantic_weight)
        else:
            merged[rid] = {**r, "score": r["score"] * (1 - semantic_weight)}

    results = sorted(merged.values(), key=lambda x: x["score"], reverse=True)
    return results[:top_k]


def _metadata_file_path(metadata: str | None) -> str:
    if not metadata:
        return ""
    try:
        data = json.loads(metadata)
    except (json.JSONDecodeError, TypeError):
        return ""
    return data.get("file_path") or data.get("source_file_path") or ""
