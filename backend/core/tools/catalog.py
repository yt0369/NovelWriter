"""
工具目录：定义每个工具的元数据。
对标 NovelIDE 的 toolCatalog.ts。
"""


TOOL_CATALOG: dict[str, dict] = {
    # ─── 文件工具 ─────────────────────────────
    "read_file": {"description": "读取文件内容", "category": "file"},
    "write_file": {"description": "写入文件（需审批）", "category": "file"},
    "patch_file": {"description": "查找替换文件内容（需审批）", "category": "file"},
    "glob": {"description": "按模式搜索文件", "category": "file"},
    "grep": {"description": "在文件中搜索文本", "category": "file"},

    # ─── 控制工具 ─────────────────────────────
    "thinking": {"description": "内部思考（不显示给用户）", "category": "control"},
    "final_answer": {"description": "给出最终回复", "category": "control"},
    "ask_questions": {"description": "向用户提问", "category": "control"},
    "reflection": {"description": "内部推理记录", "category": "control"},

    # ─── 记忆工具 ─────────────────────────────
    "query_memory": {"description": "查询知识图谱", "category": "memory"},
    "manage_memory": {"description": "管理知识节点", "category": "memory"},
    "link_memory": {"description": "创建知识关联", "category": "memory"},
    "promote_to_shared": {"description": "提升为共享知识", "category": "memory"},

    # ─── 技能工具 ─────────────────────────────
    "activate_skill": {"description": "激活技能", "category": "skill"},
    "list_skills": {"description": "列出可用技能", "category": "skill"},

    # ─── 时间线工具 ───────────────────────────
    "create_volume": {"description": "创建卷", "category": "timeline"},
    "create_chapter": {"description": "创建章节", "category": "timeline"},
    "create_event": {"description": "创建事件", "category": "timeline"},
    "update_event": {"description": "更新事件", "category": "timeline"},
    "list_events": {"description": "列出事件", "category": "timeline"},
    "create_storyline": {"description": "创建故事线", "category": "timeline"},
    "link_event_to_storyline": {"description": "关联事件与故事线", "category": "timeline"},

    # ─── 伏笔工具 ─────────────────────────────
    "create_foreshadow": {"description": "创建伏笔", "category": "foreshadowing"},
    "update_foreshadow_status": {"description": "更新伏笔状态", "category": "foreshadowing"},
    "list_foreshadows": {"description": "列出伏笔", "category": "foreshadowing"},
    "check_unresolved_foreshadows": {"description": "检查未回收伏笔", "category": "foreshadowing"},

    # ─── 角色工具 ─────────────────────────────
    "create_character": {"description": "创建角色", "category": "character"},
    "update_character": {"description": "更新角色", "category": "character"},
    "get_character_profile": {"description": "获取角色档案", "category": "character"},
    "list_characters": {"description": "列出角色", "category": "character"},
    "link_characters": {"description": "关联角色", "category": "character"},

    # ─── 大纲工具 ─────────────────────────────
    "create_outline_section": {"description": "创建大纲段落", "category": "outline"},
    "update_outline_section": {"description": "更新大纲段落", "category": "outline"},
    "get_outline_structure": {"description": "获取大纲结构", "category": "outline"},

    # ─── 任务工具 ─────────────────────────────
    "manageTodos": {"description": "管理待办任务", "category": "task"},

    # ─── 进化工具 ─────────────────────────────
    "query_evolution": {"description": "查询进化记忆", "category": "evolution"},
    "manage_evolution": {"description": "管理进化记忆", "category": "evolution"},

    # ─── 问卷工具 ─────────────────────────────
    "ask_questions": {"description": "向用户提出结构化问题", "category": "questionnaire"},

    # ─── 计划工具 ─────────────────────────────
    "manage_plan_note": {"description": "管理计划笔记", "category": "plan"},
}


def get_filtered_catalog(category: str = "") -> dict[str, dict]:
    """获取过滤后的工具目录。"""
    if not category:
        return TOOL_CATALOG
    return {k: v for k, v in TOOL_CATALOG.items() if v.get("category") == category}


def get_tool_categories() -> list[str]:
    """获取所有工具类别。"""
    return sorted(set(v["category"] for v in TOOL_CATALOG.values()))


def search_tools(query: str) -> list[dict]:
    """搜索工具目录。"""
    query_lower = query.lower()
    results = []
    for name, meta in TOOL_CATALOG.items():
        if query_lower in name.lower() or query_lower in meta["description"].lower():
            results.append({"name": name, **meta})
    return results
