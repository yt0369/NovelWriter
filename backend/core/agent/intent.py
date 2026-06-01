from __future__ import annotations

import json
import re
from typing import Any

from core.skills.assets import get_skill_activation_hints
from core.skills.registry import get_skill


SKILL_RULES: list[dict[str, Any]] = [
    {
        "id": "dialogue_writing",
        "keywords": ["对话", "对白", "交谈", "谈话", "争吵", "谈判", "台词", "说话"],
        "reason": "文本包含对话或人物交流要求",
    },
    {
        "id": "combat_scenes",
        "keywords": ["战斗", "打斗", "比武", "厮杀", "追杀", "交手", "冲突"],
        "reason": "文本包含战斗或冲突场景要求",
    },
    {
        "id": "emotion_rendering",
        "keywords": ["情绪", "心理", "崩溃", "爆发", "痛苦", "愤怒", "悲伤", "恐惧", "心动", "转折"],
        "reason": "文本包含情绪变化或心理渲染要求",
    },
    {
        "id": "scene_description",
        "keywords": ["场景", "环境", "氛围", "新地点", "城市", "宗门", "秘境", "房间", "街道", "雨夜"],
        "reason": "文本包含场景或环境描写要求",
    },
    {
        "id": "character_status",
        "keywords": ["角色状态", "状态变化", "受伤", "能力", "关系变化", "当前位置", "人物状态"],
        "reason": "文本涉及角色状态变化",
    },
    {
        "id": "strand_weave",
        "keywords": ["伏笔", "铺垫", "回收", "线索", "埋线"],
        "reason": "文本涉及伏笔推进或线索编织",
    },
    {
        "id": "pleasure_rhythm_manager",
        "keywords": ["爽点", "节奏", "期待", "高潮", "反转", "钩子"],
        "reason": "文本涉及节奏、爽点或章末钩子",
    },
]

BASE_SKILLS_BY_INTENT: dict[str, list[tuple[str, str]]] = {
    "creative_planning": [
        ("project_init", "总体创作规划需要读取项目基本信息并生成创作方向"),
        ("world_builder", "总体创作规划需要建立世界观与核心设定"),
        ("character_designer", "总体创作规划需要判断角色设计优先级"),
        ("outline_architect", "总体创作规划需要安排大纲和推进顺序"),
        ("pleasure_rhythm_manager", "总体创作规划需要安排节奏和阶段目标"),
    ],
    "world_build": [
        ("project_init", "构建世界观需要生成项目核心设定"),
        ("world_builder", "构建世界观必须激活世界观技能"),
    ],
    "character_build": [
        ("character_designer", "角色设计必须激活角色设计技能"),
        ("character_status", "角色设计需要关注初始状态和关系变化"),
    ],
    "character_update": [
        ("character_designer", "角色修改需要角色设计技能"),
        ("character_status", "角色修改需要关注角色状态"),
    ],
    "outline_build": [
        ("outline_architect", "大纲规划必须激活大纲架构技能"),
        ("expectation_manager", "大纲规划需要管理读者期待"),
        ("pleasure_rhythm_manager", "大纲规划需要安排节奏和钩子"),
    ],
    "chapter_draft": [("draft_writer", "章节写作必须激活正文写作技能")],
    "chapter_review": [("editor_review", "章节审稿必须激活编辑审稿技能")],
    "chapter_polish": [("text_polish", "章节润色必须激活文本润色技能")],
    "character_world_maintenance": [("character_status", "维护角色或世界观时需要关注角色状态")],
    "option_selection": [],
}

INTENT_SYSTEM_PROMPT = """你是小说创作工具的意图分类器。根据用户消息判断其意图并返回 JSON。

可选意图及属性：
- project_dialogue: 一般项目对话、闲聊、表达状态（默认）。requires_context=true, will_write=false, workflow=null
- creative_planning: 规划小说整体创作方向、讨论下一步方案。requires_context=true, will_write=false, workflow=null
- option_selection: 用户从上一轮提供的选项中进行选择（如"A""选项B""选第一个"）。requires_context=true, will_write=false, workflow=null
- world_build: 构建、生成、完善世界观和核心设定。requires_context=true, will_write=true, workflow=project_init
- character_build: 设计、生成、创建角色和人物关系。requires_context=true, will_write=true, workflow=character_build
- character_update: 修改、更新已有角色的特定设定（如金手指、背景、性格等）。requires_context=true, will_write=true, workflow=character_update
- outline_build: 生成、规划大纲和章节安排。requires_context=true, will_write=true, workflow=outline_build
- chapter_draft: 写章节正文、生成初稿、续写。requires_context=true, will_write=true, workflow=chapter_draft
- chapter_review: 审稿、检查、评价章节质量。requires_context=true, will_write=false, workflow=chapter_review
- chapter_polish: 润色、优化文风、去 AI 味。requires_context=true, will_write=true, workflow=chapter_polish
- chapter_task: 处理章节任务、处理审稿问题。requires_context=true, will_write=false, workflow=chapter_task
- configuration_help: 询问配置、API、模型、使用帮助。requires_context=false, will_write=false, workflow=null
- project_query: 查询项目事实（角色、伏笔、时间线等）。requires_context=true, will_write=false, workflow=null
- character_world_maintenance: 维护角色状态、更新设定、管理伏笔。requires_context=true, will_write=false, workflow=null

只输出 JSON，格式：
{"intent": "...", "confidence": 0.0-1.0, "reasons": ["判断依据"], "suggested_workflow": "...或null"}

规则：
1. 如果用户只是聊天、闲聊、表达情绪，用 project_dialogue
2. 如果用户要生成/创建/设计某物，用对应的生成类意图
3. 如果用户要查询/查看/总结已有内容，用 project_query
4. 如果用户要处理任务/问题列表，用 chapter_task
5. 如果无法确定，用 project_dialogue"""

def _keyword_fallback_intent(text: str, chapter_index: int | None = None) -> dict[str, Any]:
    lowered = text.lower()
    reasons: list[str] = []

    def has_any(words: list[str]) -> bool:
        return any(word in text or word.lower() in lowered for word in words)

    # 选项选择检测：A/B/C/D、选项X、选第X个、我选X
    if re.match(r'^[A-Da-d]$', text.strip()) or re.match(r'^选项\s*[A-Da-d]$', text.strip()) or re.match(r'^选\s*第?\s*[一二三四1-4]\s*个?$', text.strip()) or re.match(r'^我选\s*[A-Da-d一二三四1-4]$', text.strip()):
        return {"intent": "option_selection", "confidence": 0.92, "reasons": ["关键词回退：选项选择"], "suggested_workflow": None}

    if chapter_index or re.search(r"第\s*(?:\d+|[一二三四五六七八九十百零〇]+)\s*章", text) or any(w in text for w in ["写一章", "写章节", "写正文", "生成章节", "续写"]):
        return {"intent": "chapter_draft", "confidence": 0.88, "reasons": ["关键词回退：章节写作"], "suggested_workflow": "chapter_draft"}
    if has_any(["构建世界观", "核心设定", "世界观设定"]):
        return {"intent": "world_build", "confidence": 0.86, "reasons": ["关键词回退：世界观"], "suggested_workflow": "project_init"}
    if has_any(["修改角色", "更新角色", "改一下角色", "修改人物", "更新人物", "改一下人物", "调整角色", "调整人物"]):
        return {"intent": "character_update", "confidence": 0.86, "reasons": ["关键词回退：修改角色"], "suggested_workflow": "character_update"}
    if has_any(["设计角色", "角色设计", "人物设计", "角色构建", "创建角色"]):
        return {"intent": "character_build", "confidence": 0.84, "reasons": ["关键词回退：角色"], "suggested_workflow": "character_build"}
    if has_any(["大纲", "章纲", "总纲"]) and has_any(["生成", "规划", "设计", "写"]):
        return {"intent": "outline_build", "confidence": 0.84, "reasons": ["关键词回退：大纲"], "suggested_workflow": "outline_build"}
    if has_any(["审稿", "审核", "检查"]) and not has_any(["润色"]):
        return {"intent": "chapter_review", "confidence": 0.86, "reasons": ["关键词回退：审稿"], "suggested_workflow": "chapter_review"}
    if has_any(["润色", "改写", "去ai味"]):
        return {"intent": "chapter_polish", "confidence": 0.86, "reasons": ["关键词回退：润色"], "suggested_workflow": "chapter_polish"}
    if has_any(["规划小说", "创作规划", "整体规划"]):
        return {"intent": "creative_planning", "confidence": 0.86, "reasons": ["关键词回退：创作规划"], "suggested_workflow": None}
    if has_any(["查一下", "查询", "当前"]) and has_any(["角色", "伏笔", "设定"]):
        return {"intent": "project_query", "confidence": 0.76, "reasons": ["关键词回退：查询"], "suggested_workflow": None}
    if has_any(["配置", "api", "key", "帮助"]):
        return {"intent": "configuration_help", "confidence": 0.78, "reasons": ["关键词回退：配置"], "suggested_workflow": None}
    if has_any(["任务", "必须处理"]) and not has_any(["写", "生成"]):
        return {"intent": "chapter_task", "confidence": 0.8, "reasons": ["关键词回退：任务"], "suggested_workflow": "chapter_task"}
    if has_any(["角色状态", "维护", "更新设定"]):
        return {"intent": "character_world_maintenance", "confidence": 0.76, "reasons": ["关键词回退：维护"], "suggested_workflow": None}
    return {"intent": "project_dialogue", "confidence": 0.55, "reasons": ["关键词回退：默认对话"], "suggested_workflow": None}


WILL_WRITE_INTENTS = frozenset({
    "world_build", "character_build", "character_update", "outline_build", "chapter_draft", "chapter_polish",
})


async def classify_agent_intent(
    message: str,
    provider: Any = None,
    chapter_index: int | None = None,
    title: str | None = None,
    active_file_path: str | None = None,
) -> dict[str, Any]:
    text = " ".join(part for part in [message or "", title or "", active_file_path or ""] if part).strip()

    if provider is None:
        data = _keyword_fallback_intent(text, chapter_index)
    else:
        user_prompt = f"用户消息：{text}"
        if chapter_index:
            user_prompt += f"\n章节索引：第{chapter_index}章"
        try:
            raw = await provider.chat(
                messages=[
                    {"role": "system", "content": INTENT_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,
            )
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[-1]
                if cleaned.endswith("```"):
                    cleaned = cleaned[:-3]
                cleaned = cleaned.strip()
            data = json.loads(cleaned)
        except Exception:
            data = {"intent": "project_dialogue", "confidence": 0.55, "reasons": ["LLM 分类失败，回退到默认"]}

    intent = data.get("intent", "project_dialogue")
    preview = {
        "intent": intent,
        "confidence": data.get("confidence", 0.55),
        "reasons": data.get("reasons", []),
        "suggested_workflow": data.get("suggested_workflow"),
        "requires_context": intent != "configuration_help",
        "will_write": intent in WILL_WRITE_INTENTS,
    }
    preview["suggested_skills"] = suggest_skills(text, intent)
    preview["skill_activation_trace"] = preview["suggested_skills"]
    return preview


async def build_intent_preview(
    message: str,
    provider: Any = None,
    chapter_index: int | None = None,
    title: str | None = None,
    active_file_path: str | None = None,
) -> dict[str, Any]:
    return await classify_agent_intent(message, provider, chapter_index, title, active_file_path)


def suggest_skills(text: str, intent: str) -> list[dict[str, str]]:
    trace: list[dict[str, str]] = []
    seen: set[str] = set()

    for skill_id, reason in BASE_SKILLS_BY_INTENT.get(intent, []):
        _append_skill_trace(trace, seen, skill_id, reason, f"intent:{intent}", "intent")

    if intent in {
        "creative_planning",
        "world_build",
        "character_build",
        "character_update",
        "outline_build",
        "chapter_draft",
        "chapter_review",
        "chapter_polish",
        "character_world_maintenance",
        "project_query",
    }:
        for rule in SKILL_RULES:
            asset_hints = get_skill_activation_hints(rule["id"])
            matched = _matched_activation_hints(text, asset_hints)
            source = "activation_hints"
            if not matched:
                matched = [kw for kw in rule["keywords"] if kw in text]
                source = "fallback_keywords"
            if matched:
                _append_skill_trace(
                    trace,
                    seen,
                    rule["id"],
                    f"{rule['reason']}：{', '.join(matched[:3])}",
                    f"{source}:{matched[0]}",
                    "keyword",
                )
    return trace


def skill_activation_trace_for_names(names: list[str], reason: str, trigger: str) -> list[dict[str, str]]:
    trace: list[dict[str, str]] = []
    seen: set[str] = set()
    for name in names:
        _append_skill_trace(trace, seen, name, reason, trigger, "workflow")
    return trace


def _matched_activation_hints(text: str, hints: list[str]) -> list[str]:
    matched: list[str] = []
    for hint in hints:
        for token in re.split(r"[/、,，;；:：\s]+", hint):
            token = token.strip("`\"'（）()[]【】")
            if len(token) >= 2 and token in text and token not in matched:
                matched.append(token)
    return matched


def _append_skill_trace(
    trace: list[dict[str, str]],
    seen: set[str],
    skill_id: str,
    reason: str,
    trigger: str,
    source_type: str,
) -> None:
    if skill_id in seen:
        return
    seen.add(skill_id)
    skill = get_skill(skill_id)
    trace.append({
        "id": skill_id,
        "name": skill.display_name if skill else skill_id,
        "source": skill.source if skill and skill.source else "builtin",
        "category": skill.category if skill and skill.category else "",
        "reason": reason,
        "trigger": trigger,
        "source_type": source_type,
    })
