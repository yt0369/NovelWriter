from models.tools import ToolDefinition, ToolFunction, ToolCall, ToolResult, ToolResultStatus, PendingChange
from core.tools.file_tools import get_file_tool_definitions, execute_file_tool
from core.tools.control_tools import get_control_tool_definitions, execute_control_tool
from core.memory.tools import get_memory_tool_definitions, execute_memory_tool
from core.skills.tools import get_skill_tool_definitions, execute_skill_tool
from core.tools.timeline_tools import get_timeline_tool_definitions, execute_timeline_tool
from core.tools.foreshadowing_tools import get_foreshadowing_tool_definitions, execute_foreshadowing_tool
from core.tools.character_tools import get_character_tool_definitions, execute_character_tool
from core.tools.outline_tools import get_outline_tool_definitions, execute_outline_tool
from core.tools import todo_tools
from core.tools import questionnaire_tools
from core.tools import plan_note_tools
from core.tools.deep_thinking_tools import get_deep_thinking_tool_definitions, execute_deep_thinking_tool
from core.tools.global_soul_tools import get_global_soul_tool_definitions, execute_global_soul_tool
from core.tools.project_tools import get_project_tool_definitions, execute_project_tool
from core.tools.evolution_tools import get_evolution_tool_definitions, execute_evolution_tool

TIER1_TOOL_NAMES = {"read_file", "write_file", "patch_file", "glob", "grep", "query_memory", "final_answer", "ask_questions", "thinking", "reflection", "manageTodos", "manage_plan_note", "manage_global_soul", "query_evolution", "manage_evolution", "search_tools"}

TIER2_TOOL_MAP: dict[str, list[str]] = {
    "character_designer": ["create_character", "update_character", "get_character_profile", "list_characters", "query_relationships", "manage_relationships", "manage_sub_category", "archive_entry", "get_relationship_graph"],
    "character_status": ["create_character", "update_character", "get_character_profile", "list_characters", "query_relationships", "manage_relationships", "manage_sub_category", "archive_entry", "get_relationship_graph"],
    "world_builder": ["create_outline_section", "update_outline_section", "get_outline_structure"],
    "outline_architect": [
        "create_outline_section", "update_outline_section", "get_outline_structure",
        "create_volume", "create_chapter", "create_event", "update_event", "list_events",
        "create_storyline", "link_event_to_storyline",
        "create_foreshadow", "update_foreshadow_status", "list_foreshadows", "check_unresolved_foreshadows",
    ],
    "outline_creation": [
        "create_outline_section", "update_outline_section", "get_outline_structure",
        "create_volume", "create_chapter", "create_event", "update_event", "list_events",
    ],
    "strand_weave": ["create_event", "list_events", "create_storyline", "link_event_to_storyline"],
    "expectation_manager": ["create_foreshadow", "update_foreshadow_status", "list_foreshadows", "check_unresolved_foreshadows"],
    "draft_writer": [
        "read_file", "write_file", "patch_file", "glob", "grep", "query_memory", "manageTodos",
        "get_outline_structure", "list_events", "create_event", "update_event",
        "list_characters", "get_character_profile", "query_relationships", "manage_relationships",
        "list_foreshadows", "check_unresolved_foreshadows", "create_foreshadow", "update_foreshadow_status",
    ],
    "draft_writing": [
        "read_file", "write_file", "patch_file", "glob", "grep", "query_memory", "manageTodos",
        "get_outline_structure", "list_events", "create_event", "update_event",
        "list_characters", "get_character_profile", "query_relationships", "manage_relationships",
        "list_foreshadows", "check_unresolved_foreshadows", "create_foreshadow", "update_foreshadow_status",
    ],
    "draft_expander": ["read_file", "write_file", "patch_file", "query_memory"],
    "dialogue_writing": ["read_file", "write_file", "patch_file", "query_memory"],
    "combat_scenes": ["read_file", "write_file", "patch_file", "query_memory"],
    "emotion_rendering": ["read_file", "write_file", "patch_file", "query_memory"],
    "pleasure_rhythm_manager": ["read_file", "write_file", "patch_file", "query_memory"],
    "editor_review": ["read_file", "query_memory"],
    "text_polish": ["read_file", "write_file", "patch_file"],
    "constraint_layered_design": ["query_memory", "manage_memory"],
    "project_init": ["read_file", "write_file", "query_memory", "manage_memory"],
    "core_protocol": ["read_file", "query_memory"],
    "deep_thinking": ["read_file", "query_memory", "deep_thinking"],
    "scene_description": ["read_file", "write_file", "patch_file", "query_memory"],
}


def get_tier1_tool_definitions() -> list[ToolDefinition]:
    all_tools = get_all_tool_definitions()
    return [t for t in all_tools if t.function.name in TIER1_TOOL_NAMES]


def get_tier2_tool_names_for_skills(active_skill_names: set[str]) -> set[str]:
    tier2_names: set[str] = set()
    for skill_name in active_skill_names:
        tool_names = TIER2_TOOL_MAP.get(skill_name)
        if tool_names:
            tier2_names.update(tool_names)
    tier2_names -= TIER1_TOOL_NAMES
    return tier2_names


def get_lightweight_tool_definitions(active_skill_names: set[str] | None = None) -> list[ToolDefinition]:
    """获取轻量级工具定义（Tier2 只含 name+description，不含 parameters schema）。"""
    all_tools = get_all_tool_definitions(active_skill_names)
    lightweight = []
    for t in all_tools:
        if t.function.name in TIER1_TOOL_NAMES:
            lightweight.append(t)
        elif active_skill_names is not None:
            # Tier2 工具：只保留 name + description，不传参数 schema
            lightweight.append(ToolDefinition(
                function=ToolFunction(
                    name=t.function.name,
                    description=t.function.description,
                    parameters={"type": "object", "properties": {}},
                )
            ))
        else:
            lightweight.append(t)
    return lightweight


def get_all_tool_definitions(active_skill_names: set[str] | None = None) -> list[ToolDefinition]:
    all_tools = []
    all_tools.extend(get_file_tool_definitions())
    all_tools.extend(get_control_tool_definitions())
    all_tools.extend(get_memory_tool_definitions())
    all_tools.extend(get_skill_tool_definitions())
    all_tools.extend(get_timeline_tool_definitions())
    all_tools.extend(get_foreshadowing_tool_definitions())
    all_tools.extend(get_character_tool_definitions())
    all_tools.extend(get_outline_tool_definitions())
    all_tools.extend(todo_tools.get_tool_definitions())
    all_tools.extend(questionnaire_tools.get_tool_definitions())
    all_tools.extend(plan_note_tools.get_tool_definitions())
    all_tools.extend(get_deep_thinking_tool_definitions())
    all_tools.extend(get_global_soul_tool_definitions())
    all_tools.extend(get_project_tool_definitions())
    all_tools.extend(get_evolution_tool_definitions())

    # search_tools 工具
    all_tools.append(ToolDefinition(function=ToolFunction(
        name="search_tools",
        description="搜索可用工具，返回匹配的工具列表",
        parameters={"type": "object", "properties": {
            "query": {"type": "string", "description": "搜索关键词"},
        }, "required": ["query"]},
    )))

    if active_skill_names is None:
        return all_tools

    allowed = set(TIER1_TOOL_NAMES)
    allowed |= {"activate_skill", "list_skills"}
    allowed |= get_tier2_tool_names_for_skills(active_skill_names)
    return [t for t in all_tools if t.function.name in allowed]


async def execute_tool(tool_call: ToolCall, project_id: str) -> ToolResult:
    file_tools = {"read_file", "write_file", "patch_file", "glob", "grep", "delete_file", "rename_file"}
    control_tools = {"thinking", "final_answer"}
    memory_tools = {"query_memory", "manage_memory", "link_memory", "promote_to_shared", "memory_status", "traverse_memory"}
    skill_tools = {"activate_skill", "list_skills"}
    timeline_tools = {"create_volume", "create_chapter", "create_event", "update_event", "list_events", "create_storyline", "link_event_to_storyline"}
    foreshadowing_tools = {"create_foreshadow", "update_foreshadow_status", "list_foreshadows", "check_unresolved_foreshadows"}
    character_tools = {"create_character", "update_character", "get_character_profile", "list_characters", "link_characters", "query_relationships", "manage_relationships", "manage_sub_category", "archive_entry", "get_relationship_graph"}
    outline_tools = {"create_outline_section", "update_outline_section", "get_outline_structure"}
    todo_tools_set = {"manageTodos"}
    questionnaire_tools_set = {"ask_questions"}
    plan_note_tools_set = {"manage_plan_note"}
    deep_thinking_tools_set = {"deep_thinking"}
    global_soul_tools_set = {"manage_global_soul"}
    project_tools_set = {"update_project_meta"}
    evolution_tools_set = {"query_evolution", "manage_evolution"}

    if tool_call.name == "search_tools":
        from core.tools.catalog import search_tools
        query = tool_call.arguments.get("query", "")
        results = search_tools(query)
        return ToolResult(status=ToolResultStatus.EXECUTED, tool_name="search_tools", result={"tools": results, "count": len(results)})

    if tool_call.name in file_tools:
        return await execute_file_tool(tool_call, project_id)
    elif tool_call.name in control_tools:
        return await execute_control_tool(tool_call)
    elif tool_call.name in memory_tools:
        return await execute_memory_tool(tool_call, project_id)
    elif tool_call.name in skill_tools:
        return await execute_skill_tool(tool_call)
    elif tool_call.name in timeline_tools:
        return await execute_timeline_tool(tool_call, project_id)
    elif tool_call.name in foreshadowing_tools:
        return await execute_foreshadowing_tool(tool_call, project_id)
    elif tool_call.name in character_tools:
        return await execute_character_tool(tool_call, project_id)
    elif tool_call.name in outline_tools:
        return await execute_outline_tool(tool_call, project_id)
    elif tool_call.name in todo_tools_set:
        return await todo_tools.execute(tool_call, project_id)
    elif tool_call.name in questionnaire_tools_set:
        return await questionnaire_tools.execute(tool_call, project_id)
    elif tool_call.name in plan_note_tools_set:
        return await plan_note_tools.execute(tool_call, project_id)
    elif tool_call.name in deep_thinking_tools_set:
        return await execute_deep_thinking_tool(tool_call, project_id)
    elif tool_call.name in global_soul_tools_set:
        return await execute_global_soul_tool(tool_call, project_id)
    elif tool_call.name in project_tools_set:
        return await execute_project_tool(tool_call, project_id)
    elif tool_call.name in evolution_tools_set:
        return await execute_evolution_tool(tool_call, project_id)
    else:
        return ToolResult(
            status=ToolResultStatus.ERROR,
            tool_name=tool_call.name,
            error=f"未知工具: {tool_call.name}",
        )
