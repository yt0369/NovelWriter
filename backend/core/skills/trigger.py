"""
技能自动触发：基于关键词匹配和语义相似度。
"""
from core.skills.registry import get_all_skills, activate_skill, Skill


def detect_skill_triggers(user_message: str) -> list[Skill]:
    """检测用户消息中可能触发的技能。"""
    triggered = []
    msg_lower = user_message.lower()

    for skill in get_all_skills():
        if not skill.auto_trigger:
            continue

        # 关键词匹配
        for kw in skill.keywords:
            if kw.lower() in msg_lower:
                triggered.append(skill)
                break

    return triggered


def auto_activate_skills(user_message: str) -> list[str]:
    """自动激活匹配的技能，返回激活的技能名列表。"""
    triggered = detect_skill_triggers(user_message)
    activated = []
    for skill in triggered:
        activate_skill(skill.name)
        activated.append(skill.name)
    return activated
