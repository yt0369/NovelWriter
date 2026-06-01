"""
时间线API：卷、章、事件、故事线的完整CRUD。
"""
import time
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.database import get_db

router = APIRouter()


# ─── 请求模型 ────────────────────────────────────────────────

class VolumeCreate(BaseModel):
    name: str
    description: str = ""
    sort_order: int = 0


class VolumeUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    sort_order: int | None = None


class ChapterCreate(BaseModel):
    volume_id: str | None = None
    name: str
    summary: str = ""
    sort_order: int = 0
    file_path: str = ""


class ChapterUpdate(BaseModel):
    volume_id: str | None = None
    name: str | None = None
    summary: str | None = None
    sort_order: int | None = None
    file_path: str | None = None


class EventCreate(BaseModel):
    chapter_id: str | None = None
    name: str
    description: str = ""
    day: int | None = None
    hour: int | None = None
    story_line_id: str | None = None
    status: str = "planned"


class EventUpdate(BaseModel):
    chapter_id: str | None = None
    name: str | None = None
    description: str | None = None
    day: int | None = None
    hour: int | None = None
    story_line_id: str | None = None
    status: str | None = None


class StoryLineCreate(BaseModel):
    name: str
    color: str = "#a78bfa"
    is_main: bool = False


class StoryLineUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    is_main: bool | None = None


# ─── 卷 CRUD ─────────────────────────────────────────────────

@router.get("/{project_id}/volumes")
async def list_volumes(project_id: str):
    db = await get_db(project_id)
    rows = await db.execute_fetchall(
        "SELECT * FROM timeline_volumes WHERE project_id = ? ORDER BY sort_order",
        (project_id,),
    )
    await db.close()
    return [dict(r) for r in rows]


@router.post("/{project_id}/volumes")
async def create_volume(project_id: str, body: VolumeCreate):
    vid = str(uuid.uuid4())[:8]
    db = await get_db(project_id)
    await db.execute(
        "INSERT INTO timeline_volumes (id, project_id, name, description, sort_order) VALUES (?, ?, ?, ?, ?)",
        (vid, project_id, body.name, body.description, body.sort_order),
    )
    await db.commit()
    await db.close()
    return {"id": vid, "name": body.name, "description": body.description, "sort_order": body.sort_order}


@router.patch("/{project_id}/volumes/{volume_id}")
async def update_volume(project_id: str, volume_id: str, body: VolumeUpdate):
    db = await get_db(project_id)
    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        await db.execute(f"UPDATE timeline_volumes SET {set_clause} WHERE id = ?", list(updates.values()) + [volume_id])
        await db.commit()
    await db.close()
    return {"status": "updated"}


@router.delete("/{project_id}/volumes/{volume_id}")
async def delete_volume(project_id: str, volume_id: str):
    db = await get_db(project_id)
    await db.execute("DELETE FROM timeline_volumes WHERE id = ?", (volume_id,))
    await db.commit()
    await db.close()
    return {"status": "deleted"}


# ─── 章 CRUD ─────────────────────────────────────────────────

@router.get("/{project_id}/chapters")
async def list_chapters(project_id: str, volume_id: str | None = None):
    db = await get_db(project_id)
    if volume_id:
        rows = await db.execute_fetchall(
            "SELECT * FROM timeline_chapters WHERE project_id = ? AND volume_id = ? ORDER BY sort_order",
            (project_id, volume_id),
        )
    else:
        rows = await db.execute_fetchall(
            "SELECT * FROM timeline_chapters WHERE project_id = ? ORDER BY sort_order",
            (project_id,),
        )
    await db.close()
    return [dict(r) for r in rows]


@router.post("/{project_id}/chapters")
async def create_chapter(project_id: str, body: ChapterCreate):
    cid = str(uuid.uuid4())[:8]
    db = await get_db(project_id)
    await db.execute(
        "INSERT INTO timeline_chapters (id, volume_id, project_id, name, summary, sort_order, file_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (cid, body.volume_id, project_id, body.name, body.summary, body.sort_order, body.file_path),
    )
    await db.commit()
    await db.close()
    return {"id": cid, "name": body.name, "volume_id": body.volume_id}


@router.patch("/{project_id}/chapters/{chapter_id}")
async def update_chapter(project_id: str, chapter_id: str, body: ChapterUpdate):
    db = await get_db(project_id)
    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        await db.execute(f"UPDATE timeline_chapters SET {set_clause} WHERE id = ?", list(updates.values()) + [chapter_id])
        await db.commit()
    await db.close()
    return {"status": "updated"}


@router.delete("/{project_id}/chapters/{chapter_id}")
async def delete_chapter(project_id: str, chapter_id: str):
    db = await get_db(project_id)
    await db.execute("DELETE FROM timeline_chapters WHERE id = ?", (chapter_id,))
    await db.commit()
    await db.close()
    return {"status": "deleted"}


# ─── 事件 CRUD ───────────────────────────────────────────────

@router.get("/{project_id}/events")
async def list_events(project_id: str, chapter_id: str | None = None, story_line_id: str | None = None):
    db = await get_db(project_id)
    sql = "SELECT * FROM timeline_events WHERE project_id = ?"
    params: list = [project_id]
    if chapter_id:
        sql += " AND chapter_id = ?"
        params.append(chapter_id)
    if story_line_id:
        sql += " AND story_line_id = ?"
        params.append(story_line_id)
    sql += " ORDER BY day NULLS LAST, hour NULLS LAST"
    rows = await db.execute_fetchall(sql, params)
    await db.close()
    return [dict(r) for r in rows]


@router.post("/{project_id}/events")
async def create_event(project_id: str, body: EventCreate):
    eid = str(uuid.uuid4())[:8]
    now = int(time.time())
    db = await get_db(project_id)
    await db.execute(
        "INSERT INTO timeline_events (id, chapter_id, project_id, name, description, day, hour, story_line_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (eid, body.chapter_id, project_id, body.name, body.description, body.day, body.hour, body.story_line_id, body.status, now),
    )
    await db.commit()
    await db.close()
    return {"id": eid, "name": body.name}


@router.patch("/{project_id}/events/{event_id}")
async def update_event(project_id: str, event_id: str, body: EventUpdate):
    db = await get_db(project_id)
    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        await db.execute(f"UPDATE timeline_events SET {set_clause} WHERE id = ?", list(updates.values()) + [event_id])
        await db.commit()
    await db.close()
    return {"status": "updated"}


@router.delete("/{project_id}/events/{event_id}")
async def delete_event(project_id: str, event_id: str):
    db = await get_db(project_id)
    await db.execute("DELETE FROM timeline_events WHERE id = ?", (event_id,))
    await db.commit()
    await db.close()
    return {"status": "deleted"}


# ─── 故事线 CRUD ─────────────────────────────────────────────

@router.get("/{project_id}/storylines")
async def list_storylines(project_id: str):
    db = await get_db(project_id)
    rows = await db.execute_fetchall(
        "SELECT * FROM story_lines WHERE project_id = ? ORDER BY is_main DESC, name",
        (project_id,),
    )
    await db.close()
    return [dict(r) for r in rows]


@router.post("/{project_id}/storylines")
async def create_storyline(project_id: str, body: StoryLineCreate):
    sid = str(uuid.uuid4())[:8]
    db = await get_db(project_id)
    await db.execute(
        "INSERT INTO story_lines (id, project_id, name, color, is_main) VALUES (?, ?, ?, ?, ?)",
        (sid, project_id, body.name, body.color, 1 if body.is_main else 0),
    )
    await db.commit()
    await db.close()
    return {"id": sid, "name": body.name}


@router.patch("/{project_id}/storylines/{storyline_id}")
async def update_storyline(project_id: str, storyline_id: str, body: StoryLineUpdate):
    db = await get_db(project_id)
    updates = {}
    for k, v in body.model_dump(exclude_none=True).items():
        if k == "is_main":
            updates[k] = 1 if v else 0
        else:
            updates[k] = v
    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        await db.execute(f"UPDATE story_lines SET {set_clause} WHERE id = ?", list(updates.values()) + [storyline_id])
        await db.commit()
    await db.close()
    return {"status": "updated"}


@router.delete("/{project_id}/storylines/{storyline_id}")
async def delete_storyline(project_id: str, storyline_id: str):
    db = await get_db(project_id)
    await db.execute("DELETE FROM story_lines WHERE id = ?", (storyline_id,))
    await db.commit()
    await db.close()
    return {"status": "deleted"}


# ─── 章节分析 ─────────────────────────────────────────────

class ChapterAnalysisItem(BaseModel):
    chapter_ref: str
    chapter_index: int | None = None
    item_type: str  # 'foreshadowing' | 'character_state' | 'plot_keypoint'
    content: dict


@router.get("/{project_id}/chapter-analysis")
async def get_chapter_analysis(project_id: str):
    """获取项目的章节分析数据"""
    db = await get_db(project_id)

    # 从 knowledge_nodes 中获取章节分析相关节点
    foreshadowing_rows = await db.execute_fetchall(
        "SELECT * FROM knowledge_nodes WHERE project_id = ? AND wing = '剧情' AND category = '伏笔' ORDER BY created_at DESC",
        (project_id,),
    )
    character_state_rows = await db.execute_fetchall(
        "SELECT * FROM character_state_history WHERE project_id = ? ORDER BY created_at DESC LIMIT 100",
        (project_id,),
    )
    plot_rows = await db.execute_fetchall(
        "SELECT * FROM knowledge_nodes WHERE project_id = ? AND wing = '剧情' AND category = '关键点' ORDER BY created_at DESC",
        (project_id,),
    )

    await db.close()

    foreshadowing = []
    for r in foreshadowing_rows:
        row = dict(r)
        foreshadowing.append({
            "id": row["id"],
            "content": row["name"],
            "type": "planted",
            "source": "chapter_analysis",
            "sourceRef": row.get("room", ""),
            "createdAt": row["created_at"],
        })

    character_states = []
    for r in character_state_rows:
        row = dict(r)
        character_states.append({
            "id": row["id"],
            "characterName": row["character_name"],
            "chapterRef": row.get("source_file_path", ""),
            "chapterIndex": row.get("chapter_index"),
            "stateDescription": row.get("state_summary"),
            "location": row.get("location"),
            "goal": row.get("goal"),
            "emotionalState": row.get("emotion"),
            "health": row.get("health"),
            "evidence": row.get("evidence"),
            "confidence": row.get("confidence"),
            "createdAt": row["created_at"],
        })

    plot_key_points = []
    for r in plot_rows:
        row = dict(r)
        plot_key_points.append({
            "id": row["id"],
            "chapterRef": row.get("room", ""),
            "description": row["name"],
            "importance": row.get("importance", "medium"),
            "createdAt": row["created_at"],
        })

    return {
        "foreshadowing": foreshadowing,
        "characterStates": character_states,
        "plotKeyPoints": plot_key_points,
    }


@router.post("/{project_id}/chapter-analysis")
async def add_chapter_analysis_item(project_id: str, body: ChapterAnalysisItem):
    """添加章节分析条目"""
    db = await get_db(project_id)
    now = int(time.time())
    item_id = str(uuid.uuid4())[:8]

    if body.item_type == "foreshadowing":
        await db.execute(
            "INSERT INTO knowledge_nodes (id, project_id, name, wing, room, category, importance, created_at, last_modified) VALUES (?, ?, ?, '剧情', ?, '伏笔', ?, ?, ?)",
            (item_id, project_id, body.content.get("content", ""), body.chapter_ref, body.content.get("importance", "normal"), now, now),
        )
    elif body.item_type == "plot_keypoint":
        await db.execute(
            "INSERT INTO knowledge_nodes (id, project_id, name, wing, room, category, importance, created_at, last_modified) VALUES (?, ?, ?, '剧情', ?, '关键点', ?, ?, ?)",
            (item_id, project_id, body.content.get("description", ""), body.chapter_ref, body.content.get("importance", "medium"), now, now),
        )
    elif body.item_type == "character_state":
        await db.execute(
            "INSERT INTO character_state_history (id, project_id, character_id, character_name, source_file_path, chapter_index, state_summary, location, goal, emotion, health, evidence, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (item_id, project_id, body.content.get("character_id", ""), body.content.get("characterName", ""), body.chapter_ref, body.chapter_index, body.content.get("stateDescription"), body.content.get("location"), body.content.get("goal"), body.content.get("emotionalState"), body.content.get("health"), body.content.get("evidence"), body.content.get("confidence"), now),
        )

    await db.commit()
    await db.close()
    return {"id": item_id, "type": body.item_type}


@router.delete("/{project_id}/chapter-analysis/{item_id}")
async def delete_chapter_analysis_item(project_id: str, item_id: str, item_type: str):
    """删除章节分析条目"""
    db = await get_db(project_id)

    if item_type in ("foreshadowing", "plot_keypoint"):
        await db.execute("DELETE FROM knowledge_nodes WHERE id = ? AND project_id = ?", (item_id, project_id))
    elif item_type == "character_state":
        await db.execute("DELETE FROM character_state_history WHERE id = ? AND project_id = ?", (item_id, project_id))

    await db.commit()
    await db.close()
    return {"status": "deleted"}
