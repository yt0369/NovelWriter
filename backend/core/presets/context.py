from __future__ import annotations

from typing import Any

from core.presets.definitions import GENRE_PRESETS
from core.skills.assets import ASSETS_DIR, parse_frontmatter
from db.database import get_db


CREATIVE_REFERENCE_LIMIT = 1800
PRIMARY_PRESET_LIMIT = 6000
CREATIVE_REFERENCE_MAX = 2


PRESET_ALIASES: dict[str, list[str]] = {
    "xuanhuan": ["玄幻", "境界", "功法", "宗门", "灵根", "法宝"],
    "xianxia": ["仙侠", "修仙", "道心", "情劫", "天劫", "因果"],
    "wuxia": ["武侠", "江湖", "侠义", "内功", "招式", "门派"],
    "urban": ["都市", "现代", "职场", "商战", "现实"],
    "scifi": ["科幻", "星际", "机甲", "文明", "科技", "舰队"],
    "mystery": ["悬疑", "推理", "线索", "谜题", "误导", "真相"],
    "history": ["历史", "朝堂", "史实", "制度", "军事"],
    "gongdou": ["宫斗", "后宫", "宫廷", "权谋", "话术"],
    "game": ["游戏竞技", "电竞", "副本", "装备", "竞技"],
    "wuxian": ["无限流", "无限", "副本闯关", "规则怪谈", "主神"],
    "zhibo": ["直播", "弹幕", "主播", "观众互动"],
    "honghuang": ["洪荒", "天道", "圣人", "量劫", "封神"],
    "yanqing": ["言情", "恋爱", "情感", "拉扯", "甜虐", "暧昧"],
    "xitong": ["系统流", "系统面板", "任务奖励", "签到"],
    "youxi_lit": ["游戏文学", "游戏叙事", "NPC", "多结局"],
    "cosmic_horror": ["宇宙恐怖", "克苏鲁", "不可名状", "理智侵蚀"],
    "history_travel": ["历史穿越", "穿越", "蝴蝶效应", "时空"],
}


async def project_preset_id(project_id: str) -> str:
    db = await get_db(project_id)
    try:
        rows = await db.execute_fetchall("SELECT preset_id FROM projects WHERE id = ?", (project_id,))
    finally:
        await db.close()
    if not rows:
        return ""
    return str(rows[0]["preset_id"] or "")


async def preset_context_enabled(project_id: str, preset_id: str) -> bool:
    preset = GENRE_PRESETS.get(preset_id)
    if not preset:
        return False
    preset_skill_ids = set(preset.get("skills") or [])
    if not preset_skill_ids:
        return True
    placeholders = ",".join("?" for _ in preset_skill_ids)
    db = await get_db(project_id)
    try:
        rows = await db.execute_fetchall(
            f"""SELECT skill_id, enabled FROM project_skill_settings
                WHERE project_id = ? AND skill_id IN ({placeholders})""",
            (project_id, *sorted(preset_skill_ids)),
        )
    finally:
        await db.close()
    if not rows:
        return True
    return any(int(row["enabled"] or 0) == 1 for row in rows)


async def build_project_preset_context(
    project_id: str,
    instruction: str = "",
    limit: int = PRIMARY_PRESET_LIMIT,
) -> dict[str, Any]:
    primary_preset_id = await project_preset_id(project_id)
    primary_enabled = bool(primary_preset_id and await preset_context_enabled(project_id, primary_preset_id))
    primary_context = _preset_pack_context(primary_preset_id, limit) if primary_enabled else ""
    creative_refs = detect_creative_reference_presets(instruction, primary_preset_id)
    creative_contexts = [
        _creative_reference_context(preset_id)
        for preset_id in creative_refs
        if _preset_pack_context(preset_id, CREATIVE_REFERENCE_LIMIT)
    ]
    context_parts = []
    if primary_context:
        context_parts.append(
            f"【主题材：{primary_preset_id}】\n"
            "事实优先：主题材只提供默认风味，不得覆盖正文事实、角色状态、时间线或世界观约束。\n\n"
            f"{primary_context}"
        )
    context_parts.extend(creative_contexts)
    policy = "disabled"
    if primary_context and creative_contexts:
        policy = "primary_plus_creative_reference"
    elif primary_context:
        policy = "primary_only"
    elif creative_contexts:
        policy = "primary_plus_creative_reference"
    return {
        "context": "\n\n".join(context_parts)[: limit + CREATIVE_REFERENCE_LIMIT * CREATIVE_REFERENCE_MAX + 1000],
        "primary_preset_id": primary_preset_id,
        "primary_enabled": primary_enabled,
        "creative_reference_presets": creative_refs,
        "preset_context_policy": policy,
    }


def detect_creative_reference_presets(instruction: str, primary_preset_id: str = "") -> list[str]:
    text = instruction or ""
    if not text:
        return []
    detected: list[str] = []
    for preset_id, aliases in PRESET_ALIASES.items():
        if preset_id == primary_preset_id:
            continue
        if any(alias and alias in text for alias in aliases + [preset_id, GENRE_PRESETS.get(preset_id, {}).get("name", "")]):
            detected.append(preset_id)
        if len(detected) >= CREATIVE_REFERENCE_MAX:
            break
    return detected


def _creative_reference_context(preset_id: str) -> str:
    body = _preset_pack_context(preset_id, CREATIVE_REFERENCE_LIMIT)
    if not body:
        return ""
    return (
        f"【本章创作自由参考：{preset_id}】\n"
        "这是本章创作自由参考，不改变项目事实和主题材；只可借用风味、节奏和表达方法。\n\n"
        f"{body}"
    )


def _preset_pack_context(preset_id: str, limit: int) -> str:
    if not preset_id:
        return ""
    preset_dir = ASSETS_DIR / "presets" / preset_id
    if not preset_dir.exists():
        return ""
    parts = []
    for path in sorted(preset_dir.glob("*.md")):
        meta, body = parse_frontmatter(path.read_text(encoding="utf-8"))
        parts.append(f"## {meta.get('name', path.stem)}\n{body[:limit]}")
    return "\n\n".join(parts)[:limit]
