"""
技能注册表：管理技能的加载、激活、衰减。
渐进式披露：技能默认休眠，激活后解锁Tier 2工具。
8轮未使用自动衰减休眠。
"""
import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Skill:
    name: str
    display_name: str
    description: str
    keywords: list[str]
    tools: list[str]  # 该技能提供的工具名
    content: str  # Markdown格式的技能内容（系统提示词注入）
    wing: str = ""  # 关联的知识翼
    auto_trigger: bool = True
    priority: int = 0
    category: str = ""
    source: str = ""
    preset: str = ""
    asset_path: str = ""


@dataclass
class ActiveSkill:
    skill: Skill
    activated_at: float = field(default_factory=time.time)
    rounds_since_use: int = 0
    use_count: int = 0


# 全局技能注册表
_skills: dict[str, Skill] = {}
_active_skills: dict[str, ActiveSkill] = {}

# 衰减配置
DECAY_ROUNDS = 8  # 8轮未使用则休眠


def register_skill(skill: Skill):
    """注册一个技能。"""
    try:
        from core.skills.assets import apply_asset_to_skill
        skill = apply_asset_to_skill(skill)
    except Exception as e:
        print(f"[skills] asset load skipped for {skill.name}: {e}")
    _skills[skill.name] = skill


def get_skill(name: str) -> Skill | None:
    """获取技能定义。"""
    return _skills.get(name)


def get_all_skills() -> list[Skill]:
    """获取所有已注册技能。"""
    return list(_skills.values())


def activate_skill(name: str) -> Skill | None:
    """激活一个技能。"""
    skill = _skills.get(name)
    if not skill:
        return None
    if name not in _active_skills:
        _active_skills[name] = ActiveSkill(skill=skill)
    else:
        _active_skills[name].rounds_since_use = 0
        _active_skills[name].use_count += 1
    return skill


def deactivate_skill(name: str):
    """手动休眠一个技能。"""
    _active_skills.pop(name, None)


def get_active_skills() -> list[ActiveSkill]:
    """获取所有激活的技能。"""
    return list(_active_skills.values())


def get_active_skill_names() -> set[str]:
    """获取激活技能的名称集合。"""
    return set(_active_skills.keys())


def tick_decay():
    """每次Agent轮次后调用，对未使用的技能进行衰减。"""
    to_remove = []
    for name, active in _active_skills.items():
        active.rounds_since_use += 1
        if active.rounds_since_use >= DECAY_ROUNDS:
            to_remove.append(name)
    for name in to_remove:
        del _active_skills[name]


def reset_decay(name: str):
    """重置某个技能的衰减计数。"""
    if name in _active_skills:
        _active_skills[name].rounds_since_use = 0
        _active_skills[name].use_count += 1


def build_skills_context() -> str:
    """构建激活技能的上下文文本，注入系统提示词。
    懒加载模式：只注入 metadata（name + description），完整内容通过 activate_skill 工具按需加载。
    """
    active = get_active_skills()
    if not active:
        return ""

    sections = ["## 已激活技能（懒加载模式）"]
    sections.append("以下技能已激活，可通过 activate_skill 工具加载完整内容：")
    for a in active:
        sections.append(f"- **{a.skill.display_name}**（{a.skill.name}）：{a.skill.description}")

    return "\n".join(sections)


def build_skills_index() -> str:
    """构建所有技能的索引（未激活的技能也列出名称和描述）。"""
    all_skills = get_all_skills()
    if not all_skills:
        return ""

    sections = ["## 可用技能索引"]
    for s in all_skills:
        sections.append(f"- **{s.display_name}**（{s.name}）：{s.description}")

    return "\n".join(sections)
