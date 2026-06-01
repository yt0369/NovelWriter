"""嵌入健康检查：扫描缺失嵌入的节点并提供修复。"""
from db.database import get_db


async def check_embedding_health(project_id: str) -> dict:
    """扫描所有 knowledge_nodes，检测缺失嵌入的节点。"""
    db = await get_db(project_id)
    try:
        rows = await db.execute_fetchall(
            "SELECT id, name, embedding FROM knowledge_nodes WHERE project_id = ?",
            (project_id,),
        )
        total = len(rows) if rows else 0
        missing = []
        for row in (rows or []):
            if not row["embedding"]:
                missing.append({"id": row["id"], "name": row["name"]})

        return {
            "total": total,
            "with_embedding": total - len(missing),
            "missing_count": len(missing),
            "missing_nodes": missing,
            "health": "healthy" if not missing else "degraded",
        }
    finally:
        await db.close()


async def repair_embeddings(project_id: str) -> dict:
    """批量修复缺失嵌入的节点。"""
    from core.memory.graph import embed_text

    db = await get_db(project_id)
    try:
        rows = await db.execute_fetchall(
            "SELECT id, name, summary, detail FROM knowledge_nodes WHERE project_id = ? AND embedding IS NULL",
            (project_id,),
        )
        repaired = 0
        for row in (rows or []):
            text = f"{row['name']} {row['summary'] or ''} {row['detail'] or ''}"
            try:
                embedding = embed_text(text)
                import json
                await db.execute(
                    "UPDATE knowledge_nodes SET embedding = ? WHERE id = ?",
                    (json.dumps(embedding), row["id"]),
                )
                repaired += 1
            except Exception:
                continue
        await db.commit()
        return {"repaired": repaired, "total_missing": len(rows) if rows else 0}
    finally:
        await db.close()


async def get_embedding_stats(project_id: str) -> dict:
    """嵌入统计信息。"""
    db = await get_db(project_id)
    try:
        rows = await db.execute_fetchall(
            "SELECT COUNT(*) as total, SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) as with_embedding FROM knowledge_nodes WHERE project_id = ?",
            (project_id,),
        )
        if rows:
            r = dict(rows[0])
            return {
                "total_nodes": r["total"],
                "with_embedding": r["with_embedding"] or 0,
                "missing_embedding": r["total"] - (r["with_embedding"] or 0),
            }
        return {"total_nodes": 0, "with_embedding": 0, "missing_embedding": 0}
    finally:
        await db.close()
