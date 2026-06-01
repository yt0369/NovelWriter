"""
核心技能定义。
每个模块导出一个 create_skill() 函数返回 Skill 对象。
"""
from core.skills.registry import Skill, register_skill
from core.skills.definitions import (
    character_designer,
    character_status,
    combat_scenes,
    constraint_layered_design,
    core_protocol,
    deep_thinking,
    dialogue_writing,
    draft_expander,
    draft_writer,
    editor_review,
    emotion_rendering,
    expectation_manager,
    outline_architect,
    outline_creation,
    pleasure_rhythm_manager,
    project_init,
    scene_description,
    strand_weave,
    text_polish,
    world_builder,
)


def register_all_skills():
    """注册所有核心技能。"""
    for mod in [
        character_designer,
        character_status,
        combat_scenes,
        constraint_layered_design,
        core_protocol,
        deep_thinking,
        dialogue_writing,
        draft_expander,
        draft_writer,
        editor_review,
        emotion_rendering,
        expectation_manager,
        outline_architect,
        outline_creation,
        pleasure_rhythm_manager,
        project_init,
        scene_description,
        strand_weave,
        text_polish,
        world_builder,
    ]:
        skill = mod.create_skill()
        register_skill(skill)
