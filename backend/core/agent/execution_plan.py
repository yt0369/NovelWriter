from __future__ import annotations

import re
from typing import Any

from core.agent.intent import build_intent_preview


WRITE_INTENTS = {"world_build", "character_build", "outline_build", "chapter_draft", "chapter_polish"}
CHAPTER_CONTEXT_INTENTS = {"chapter_draft"}
FILE_CONTEXT_INTENTS = {"chapter_review", "chapter_polish"}


async def build_agent_execution_plan(
    project_id: str,
    message: str,
    provider: Any = None,
    chapter_index: int | None = None,
    title: str = "",
    active_file_path: str = "",
) -> dict[str, Any]:
    resolved_index = chapter_index or _chapter_index_from_text(message) or _chapter_index_from_path(active_file_path) or 1
    intent = await build_intent_preview(
        message,
        provider,
        chapter_index=chapter_index,
        title=title,
        active_file_path=active_file_path,
    )
    plan: dict[str, Any] = {
        "intent": intent["intent"],
        "confidence": intent["confidence"],
        "reasons": intent["reasons"],
        "suggested_workflow": intent["suggested_workflow"],
        "requires_context": intent["requires_context"],
        "will_write": intent["will_write"],
        "pending_change_policy": "required" if intent["intent"] in WRITE_INTENTS else "none",
        "context_sources": [],
        "active_skills": intent["suggested_skills"],
        "skill_activation_trace": intent["skill_activation_trace"],
        "warnings": [],
    }

    if not intent["requires_context"]:
        return plan

    from core.presets.context import build_project_preset_context
    preset_info = await build_project_preset_context(project_id, message)
    plan.update({
        "preset_context_policy": preset_info.get("preset_context_policy", "disabled"),
        "primary_preset_id": preset_info.get("primary_preset_id", ""),
        "creative_reference_presets": preset_info.get("creative_reference_presets", []),
    })

    if intent["intent"] in CHAPTER_CONTEXT_INTENTS:
        from core.workflows import writing
        context_result = await writing.chapter_context_pack(project_id, resolved_index, title)
        pack_output = context_result.get("output", {})
        plan["context_sources"] = _context_sources_from_pack(pack_output)
        plan["readiness"] = (pack_output.get("context_pack") or {}).get("readiness", {})
        plan["chapter_index"] = resolved_index
        plan["title"] = title
        try:
            from core.chapter_tasks import chapter_task_gate
            gate = await chapter_task_gate(project_id, resolved_index)
        except ImportError:
            gate = {}
        plan["task_gate"] = gate
        if "task_gate" not in plan["context_sources"]:
            plan["context_sources"].append("task_gate")
        plan["warnings"].extend(_warnings_from_task_gate(gate))
        return plan

    if intent["intent"] in FILE_CONTEXT_INTENTS:
        plan["context_sources"] = ["chapter_file"]
        if intent["intent"] == "chapter_polish":
            plan["context_sources"].append("latest_review")
        if active_file_path:
            plan["active_file_path"] = active_file_path
        return plan

    if intent["intent"] in {"project_dialogue", "creative_planning", "world_build", "character_build", "outline_build"}:
        plan["context_sources"] = ["project_metadata", "writing_rules", "project_soul", "existing_files", "preset_context"]
        return plan

    if intent["intent"] in {"project_query", "chapter_task", "character_world_maintenance"}:
        plan["context_sources"] = ["project_assets"]
        if intent["intent"] == "chapter_task":
            from core.chapter_tasks import chapter_task_gate
            gate = await chapter_task_gate(project_id, resolved_index)
            plan["task_gate"] = gate
            plan["chapter_index"] = resolved_index
            plan["context_sources"].append("task_gate")
            plan["warnings"].extend(_warnings_from_task_gate(gate))
        return plan

    return plan


def _context_sources_from_pack(output: dict[str, Any]) -> list[str]:
    sources = ["chapter_context_pack"]
    summary = output.get("pack_summary") or {}
    for label in summary.get("included_sections") or []:
        source = _context_label_to_source(str(label))
        if source and source not in sources:
            sources.append(source)
    return sources


def _context_label_to_source(label: str) -> str:
    mapping = {
        "写作规范": "writing_rules",
        "项目 Soul": "project_soul",
        "目标章纲": "target_outline",
        "上一章摘要": "previous_chapter_summary",
        "最近章节摘要": "recent_chapter_summaries",
        "角色状态": "characters",
        "未回收伏笔": "unresolved_foreshadows",
        "时间线事件": "timeline_events",
        "世界观知识": "world_knowledge",
        "待确认知识": "pending_knowledge_candidates",
        "角色状态风险": "character_state_conflicts",
    }
    return mapping.get(label, "")


def _warnings_from_task_gate(task_gate: dict[str, Any]) -> list[dict[str, str]]:
    if int(task_gate.get("must_handle_risk") or 0) <= 0:
        return []
    return [{
        "code": "must_handle_task_risk",
        "severity": "warning",
        "message": f"当前章节有 {task_gate.get('must_handle_risk')} 个必须处理任务仍处于待处理或暂后状态。",
        "action_target": "chapter_tasks",
    }]


def _chapter_index_from_text(text: str) -> int | None:
    match = re.search(r"第\s*0*(\d+)\s*章", text or "")
    return int(match.group(1)) if match else None


def _chapter_index_from_path(path: str) -> int | None:
    match = re.search(r"第\s*0*(\d+)\s*章", path or "")
    return int(match.group(1)) if match else None
