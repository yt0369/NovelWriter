"""
工具懒加载器：未激活类别只返回 name + description，已激活类别返回完整 schema。
对标 NovelIDE 的 indexLazy.ts。
"""
from models.tools import ToolDefinition, ToolFunction


def get_all_tools_for_llm(
    all_tools: list[ToolDefinition],
    tier1_names: set[str],
    active_skill_names: set[str] | None = None,
    tier2_map: dict[str, list[str]] | None = None,
) -> list[ToolDefinition]:
    """获取供 LLM 使用的工具定义。Tier2 未激活工具只返回 name+description。"""
    if active_skill_names is None:
        return all_tools

    # 计算已激活的 Tier2 工具名
    activated_tier2: set[str] = set()
    if tier2_map:
        for skill_name in active_skill_names:
            tool_names = tier2_map.get(skill_name)
            if tool_names:
                activated_tier2.update(tool_names)
    activated_tier2 -= tier1_names

    result = []
    for t in all_tools:
        name = t.function.name
        if name in tier1_names:
            # Tier1：完整 schema
            result.append(t)
        elif name in activated_tier2:
            # Tier2 已激活：完整 schema
            result.append(t)
        else:
            # Tier2 未激活：只返回 name + description，无参数 schema
            result.append(ToolDefinition(
                function=ToolFunction(
                    name=name,
                    description=t.function.description,
                    parameters={"type": "object", "properties": {}},
                )
            ))

    return result
