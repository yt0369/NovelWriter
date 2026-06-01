import ast
from dataclasses import replace
from pathlib import Path
from typing import Any

from core.skills.registry import Skill


ASSETS_DIR = Path(__file__).parent / "assets"

LEGACY_TOOL_MAP: dict[str, list[str]] = {
    "read": ["read_file"],
    "write": ["write_file"],
    "edit": ["patch_file"],
    "file": ["read_file", "write_file", "patch_file", "glob", "grep"],
    "outline": ["create_outline_section", "update_outline_section", "get_outline_structure", "create_event", "list_events"],
    "timeline": ["create_event", "update_event", "list_events", "create_storyline", "link_event_to_storyline"],
    "character": ["create_character", "update_character", "get_character_profile", "list_characters"],
    "relationship": ["link_characters"],
    "memory": ["query_memory", "manage_memory", "link_memory"],
    "foreshadowing": ["create_foreshadow", "update_foreshadow_status", "list_foreshadows", "check_unresolved_foreshadows"],
}

VALID_TOOL_NAMES = {
    "read_file", "write_file", "patch_file", "glob", "grep",
    "query_memory", "manage_memory", "link_memory", "promote_to_shared",
    "activate_skill", "list_skills", "final_answer", "ask_questions", "thinking",
    "manageTodos", "manage_plan_note", "manage_global_soul", "query_evolution", "manage_evolution",
    "create_volume", "create_chapter", "create_event", "update_event", "list_events", "create_storyline", "link_event_to_storyline",
    "create_foreshadow", "update_foreshadow_status", "list_foreshadows", "check_unresolved_foreshadows",
    "create_character", "update_character", "get_character_profile", "list_characters", "link_characters",
    "query_relationships", "manage_relationships", "manage_sub_category", "archive_entry", "get_relationship_graph",
    "create_outline_section", "update_outline_section", "get_outline_structure",
}

CORE_QUALITY_SKILL_IDS = [
    "draft_writer",
    "editor_review",
    "text_polish",
    "dialogue_writing",
    "combat_scenes",
    "emotion_rendering",
    "scene_description",
    "character_status",
    "strand_weave",
    "pleasure_rhythm_manager",
]

SKILL_CONTRACT_SECTIONS = {
    "usage_scenarios": "适用场景",
    "input_requirements": "输入上下文要求",
    "output_contract": "输出要求",
    "forbidden_rules": "禁止事项",
    "activation_hints": "联动触发条件",
}


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    meta_text = parts[1].strip()
    body = parts[2].lstrip()
    meta: dict[str, Any] = {}
    for line in meta_text.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not value:
            meta[key] = ""
            continue
        try:
            meta[key] = ast.literal_eval(value)
        except (ValueError, SyntaxError):
            meta[key] = value.strip("\"'")
    return meta, body


def normalize_tools(tools: list[str]) -> list[str]:
    normalized: list[str] = []
    for tool in tools:
        mapped = LEGACY_TOOL_MAP.get(tool, [tool])
        for name in mapped:
            if name in VALID_TOOL_NAMES and name not in normalized:
                normalized.append(name)
    return normalized


def legacy_tools(tools: list[str]) -> list[str]:
    return [tool for tool in tools if tool in LEGACY_TOOL_MAP]


def extract_contract_sections(body: str) -> dict[str, list[str]]:
    sections = {key: [] for key in SKILL_CONTRACT_SECTIONS}
    lines = body.splitlines()
    current_key = ""
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            current_key = ""
            for key, heading in SKILL_CONTRACT_SECTIONS.items():
                if heading in stripped:
                    current_key = key
                    break
            continue
        if current_key and stripped:
            item = stripped.lstrip("-*0123456789.、 \t")
            if item:
                sections[current_key].append(item)
    return {key: values for key, values in sections.items()}


def skill_asset_detail(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(text)
    raw_tools = meta.get("tools", [])
    raw_tools = raw_tools if isinstance(raw_tools, list) else []
    mapped_tools = normalize_tools(raw_tools)
    contract = extract_contract_sections(body)
    invalid_tools = [t for t in mapped_tools if t not in VALID_TOOL_NAMES]
    return {
        "id": meta.get("id", path.stem),
        "name": meta.get("name", path.stem),
        "category": meta.get("category", ""),
        "summary": meta.get("summary", ""),
        "tags": meta.get("tags", []),
        "tools": mapped_tools,
        "raw_tools": raw_tools,
        "legacy_tools": legacy_tools(raw_tools),
        "invalid_tools": invalid_tools,
        "source": meta.get("source", ""),
        "preset": meta.get("preset", ""),
        "path": str(path.relative_to(ASSETS_DIR)).replace("\\", "/"),
        "content_length": len(body),
        **contract,
    }


def get_asset_path(skill_id: str, preset: str | None = None) -> Path | None:
    candidates = []
    if preset:
        candidates.append(ASSETS_DIR / "presets" / preset / f"{skill_id}.md")
    candidates.extend([
        ASSETS_DIR / "core" / f"{skill_id}.md",
        ASSETS_DIR / f"{skill_id}.md",
    ])
    for path in candidates:
        if path.exists():
            return path
    return None


def apply_asset_to_skill(skill: Skill) -> Skill:
    path = get_asset_path(skill.name)
    if not path:
        return skill

    text = path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(text)
    mapped_tools = normalize_tools(meta.get("tools", [])) if isinstance(meta.get("tools"), list) else []

    return replace(
        skill,
        display_name=meta.get("name", skill.display_name),
        description=meta.get("summary", skill.description),
        tools=mapped_tools or skill.tools,
        content=body or skill.content,
        category=meta.get("category", skill.category),
        source=meta.get("source", skill.source),
        priority=int(meta.get("priority", skill.priority) or 0),
        preset=meta.get("preset", skill.preset),
        asset_path=str(path),
    )


def list_skill_assets() -> list[dict[str, Any]]:
    assets = []
    if not ASSETS_DIR.exists():
        return assets
    for path in sorted(ASSETS_DIR.rglob("*.md")):
        assets.append(skill_asset_detail(path))
    return assets


def get_skill_activation_hints(skill_id: str) -> list[str]:
    path = get_asset_path(skill_id)
    if not path:
        return []
    detail = skill_asset_detail(path)
    hints = detail.get("activation_hints", [])
    if isinstance(hints, list):
        return [str(item) for item in hints if str(item).strip()]
    return []


def validate_core_skill_assets(skill_ids: list[str] | None = None) -> list[str]:
    issues: list[str] = []
    ids = skill_ids or CORE_QUALITY_SKILL_IDS
    for skill_id in ids:
        path = get_asset_path(skill_id)
        if not path:
            issues.append(f"{skill_id}: missing asset")
            continue
        text = path.read_text(encoding="utf-8")
        meta, body = parse_frontmatter(text)
        detail = skill_asset_detail(path)
        if not body.strip() or len(body.strip()) < 100:
            issues.append(f"{skill_id}: empty or too short body")
        if body.lstrip().startswith("---"):
            issues.append(f"{skill_id}: duplicate frontmatter block")
        for key, heading in SKILL_CONTRACT_SECTIONS.items():
            if not detail.get(key):
                issues.append(f"{skill_id}: missing contract section {heading}")
        for key in ("id", "name", "category", "summary", "tags", "tools", "source", "priority", "preset"):
            if key not in meta:
                issues.append(f"{skill_id}: missing frontmatter {key}")
        if detail["legacy_tools"]:
            issues.append(f"{skill_id}: legacy tools {', '.join(detail['legacy_tools'])}")
        if detail["invalid_tools"]:
            issues.append(f"{skill_id}: invalid tools {', '.join(detail['invalid_tools'])}")
    return issues
