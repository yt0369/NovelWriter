"""
技能工具：供Agent使用的技能激活工具。
"""
from models.tools import ToolDefinition, ToolFunction, ToolCall, ToolResult, ToolResultStatus
from core.skills.registry import (
    activate_skill, deactivate_skill, get_all_skills, get_active_skills, Skill,
)


def get_skill_tool_definitions() -> list[ToolDefinition]:
    return [
        ToolDefinition(function=ToolFunction(
            name="activate_skill",
            description="激活一个专业写作技能，解锁该技能的工具和提示词。使用 list_skills 查看可用技能的 name（英文ID）。",
            parameters={"type": "object", "properties": {
                "skill_name": {"type": "string", "description": "技能ID（英文name，如 outline_architect, draft_writer, character_designer），不是中文显示名"},
                "deactivate": {"type": "boolean", "description": "设为true则休眠该技能"},
            }, "required": ["skill_name"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="list_skills",
            description="列出所有可用的写作技能",
            parameters={"type": "object", "properties": {}, "required": []},
        )),
    ]


async def execute_skill_tool(tool_call: ToolCall) -> ToolResult:
    name = tool_call.name
    args = tool_call.arguments

    if name == "activate_skill":
        skill_name = args.get("skill_name", "")
        deactivate = args.get("deactivate", False)

        if deactivate:
            deactivate_skill(skill_name)
            return ToolResult(
                status=ToolResultStatus.EXECUTED,
                tool_name=name,
                result={"action": "deactivated", "skill": skill_name},
            )

        skill = activate_skill(skill_name)
        if not skill:
            return ToolResult(
                status=ToolResultStatus.ERROR,
                tool_name=name,
                error=f"技能不存在: {skill_name}",
            )
        # 懒加载：返回完整技能内容，让 LLM 可以直接使用
        return ToolResult(
            status=ToolResultStatus.EXECUTED,
            tool_name=name,
            result={
                "action": "activated",
                "skill": skill.name,
                "display_name": skill.display_name,
                "description": skill.description,
                "tools": skill.tools,
                "content": skill.content,  # 完整 prompt 内容
            },
        )

    elif name == "list_skills":
        skills = get_all_skills()
        active = {a.skill.name for a in get_active_skills()}
        return ToolResult(
            status=ToolResultStatus.EXECUTED,
            tool_name=name,
            result={
                "skills": [
                    {
                        "name": s.name,
                        "display_name": s.display_name,
                        "description": s.description,
                        "active": s.name in active,
                    }
                    for s in skills
                ],
            },
        )

    return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"未知工具: {name}")
