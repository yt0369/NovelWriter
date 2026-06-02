"""
ReAct Agent 引擎 — 对标 NovelIDE 的 useAgentEngine

核心流程：
1. 用户消息 → 技能自动触发（关键词匹配）
2. 构建系统提示 + 工具定义
3. ReAct 循环：调用 LLM → 处理响应 → 执行工具 → 继续
4. 特殊工具：final_answer（终止）、reflection（静默）、thinking（静默）
"""
import json
import logging
import re
import uuid
from pathlib import Path
from typing import Any, AsyncIterator

from config import settings
from models.tools import ToolCall, ToolResult, ToolResultStatus, PendingChange
from core.agent.context import build_system_prompt
from core.agent.compression import compress_messages
from core.memory.stack import get_contextual_memories
from core.agent.tool_runner import ToolRunner
from core.tools import get_all_tool_definitions
from core.skills.trigger import auto_activate_skills
from core.skills.registry import activate_skill, build_skills_context, get_active_skill_names
from core.skills.project_state import hydrate_project_skills
from ai.compat import friendly_api_error
from ai.provider import AIProvider
from ai.model_router import detect_task_type, get_model_config
from core.agent.reasoning import split_model_output
from utils.diff import generate_diff

logger = logging.getLogger(__name__)


MAX_ITERATIONS = 90
_ITERATION_WARNING_THRESHOLD = 20

# 内部工具：静默处理，不显示给用户
INTERNAL_TOOL_NAMES = {"reflection", "thinking"}

_RAW_TOOL_CALL_RE = re.compile(
    r'\{"tool_calls"\s*:\s*\[.*?\]\s*\}',
    re.DOTALL,
)

_SHADOW_READ_RE = re.compile(
    r'✅ 文件\s+"[^"]+"\s+的变更已排队等待用户审批。.*?请继续执行其他任务，假设此变更会被批准。',
    re.DOTALL,
)

_COMPACT_TOOL_RESULT_RE = re.compile(
    r'\s*\{[^{}\n]*"id"\s*:\s*"[^"]+"[^{}\n]*"name"\s*:\s*"[^"]+"[^{}\n]*\}\s*'
)


def _strip_raw_tool_call_json(content: str) -> str:
    """Remove raw tool_calls JSON that some models leak into content."""
    if not content:
        return content
    cleaned = _RAW_TOOL_CALL_RE.sub("", content).strip()
    if cleaned:
        return cleaned
    stripped = content.strip()
    if stripped.startswith("{") and '"tool_calls"' in stripped:
        return ""
    return content


def _sanitize_user_visible_content(content: str) -> str:
    """Keep internal tool/shadow-read artifacts out of chat-visible text."""
    if not content:
        return content
    cleaned = _strip_raw_tool_call_json(content)
    cleaned = _SHADOW_READ_RE.sub("", cleaned)
    cleaned = _COMPACT_TOOL_RESULT_RE.sub("\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    if "待审批内容（Shadow Read）" in cleaned:
        return ""
    return cleaned


_THINKING_PATTERN = re.compile(
    r"(?:意图|intent)\s*[:：]\s*(.+?)(?=(?:计划|plan)\s*[:：]|$)"
    r".*?(?:计划|plan)\s*[:：]\s*(.+?)(?=(?:反思|reflection)\s*[:：]|$)"
    r".*?(?:反思|reflection)\s*[:：]\s*(.+?)$",
    re.DOTALL | re.IGNORECASE,
)


def _extract_thinking(content: str):
    m = _THINKING_PATTERN.search(content)
    if not m:
        return None, content
    intent = m.group(1).strip()
    plan = m.group(2).strip()
    reflection = m.group(3).strip()
    cleaned = content[:m.start()] + content[m.end():]
    return {"intent": intent, "plan": plan, "reflection": reflection}, cleaned.strip()


def _missing_file_questionnaire_hint(tool_call: ToolCall, error: str) -> str:
    """Suggest asking the user when a missing key story file blocks reliable work."""
    if not settings.enable_proactive_questionnaire:
        return ""
    if tool_call.name != "read_file" or "文件不存在" not in (error or ""):
        return ""

    path = str(tool_call.arguments.get("path", "")).replace("\\", "/")
    key_patterns = {
        "角色": "角色档案缺失。请不要编造角色状态，优先调用 ask_questions 询问角色定位、当前状态和关系约束。",
        "世界": "世界观资料缺失。请不要自行补设定，优先调用 ask_questions 询问力量体系、地点规则或禁忌。",
        "大纲": "大纲资料缺失。请不要直接写正文，优先调用 ask_questions 询问本章目标、冲突、转折和章末钩子。",
        "章纲": "章纲资料缺失。请不要直接写正文，优先调用 ask_questions 询问本章目标、冲突、转折和章末钩子。",
        "章节大纲": "章节大纲资料缺失。请不要直接写正文，优先调用 ask_questions 询问本章目标、冲突、转折和章末钩子。",
        "正文": "正文资料缺失。请优先用 glob 查找相邻章节；如果仍缺前文，调用 ask_questions 询问上一章结尾状态。",
        "写作": "写作规范缺失。请调用 ask_questions 询问文风、禁忌和目标读感。",
    }
    for marker, hint in key_patterns.items():
        if marker in path:
            return f"\n\n[主动问卷提示] {hint}"
    return ""


def _tool_defs_to_openai(tools) -> list[dict]:
    """将内部ToolDefinition转为OpenAI tools格式。"""
    result = []
    for t in tools:
        result.append({
            "type": "function",
            "function": {
                "name": t.function.name,
                "description": t.function.description,
                "parameters": t.function.parameters,
            },
        })
    return result


async def run_agent(
    messages: list[dict],
    provider: AIProvider,
    project_id: str,
    project_dir: Path,
    active_file_path: str = "",
    turn_id: int = 0,
    session_id: str = "",
) -> AsyncIterator[dict[str, Any]]:
    """
    ReAct Agent引擎。AsyncGenerator，yield消息字典：
    - {"type": "delta", "content": "..."}          流式文本
    - {"type": "reasoning_delta", "content": "..."} 推理内容
    - {"type": "thinking", "intent": "...", "plan": "...", "reflection": "..."}
    - {"type": "tool_start", "name": "...", "args": {...}}
    - {"type": "tool_result", "name": "...", "result": {...}}
    - {"type": "approval_required", "pending_change": {...}}
    - {"type": "questionnaire", "questionnaire": {...}}
    - {"type": "done", "content": "..."}           最终回复
    - {"type": "error", "error": "..."}            错误
    """
    # ─── 1. 识别用户意图并激活技能 ───────────────────────
    await hydrate_project_skills(project_id)

    last_user_msg = ""
    if messages:
        for msg in reversed(messages):
            if msg.get("role") == "user":
                last_user_msg = msg.get("content", "")
                break

    if last_user_msg:
        auto_activate_skills(last_user_msg, scope=project_id)

    if last_user_msg and settings.enable_intent_detection:
        try:
            from core.agent.intent import build_intent_preview

            intent_preview = await build_intent_preview(
                last_user_msg,
                provider,
                active_file_path=active_file_path,
            )
            for skill in intent_preview.get("suggested_skills", []):
                skill_id = skill.get("id")
                if skill_id:
                    activate_skill(skill_id, scope=project_id)
            yield {
                "type": "intent",
                "turn_id": turn_id,
                **intent_preview,
                "active_skills": intent_preview.get("suggested_skills", []),
            }
        except Exception as e:
            yield {
                "type": "intent",
                "turn_id": turn_id,
                "intent": "project_dialogue",
                "confidence": 0.0,
                "reasons": [f"意图识别失败: {friendly_api_error(e)}"],
                "suggested_workflow": None,
                "active_skills": [],
            }

    if last_user_msg and settings.enable_execution_plan:
        try:
            from core.agent.execution_plan import build_agent_execution_plan

            plan = await build_agent_execution_plan(
                project_id,
                last_user_msg,
                provider,
                active_file_path=active_file_path,
            )
            for skill in plan.get("active_skills", []):
                skill_id = skill.get("id")
                if skill_id:
                    activate_skill(skill_id, scope=project_id)
            yield {"type": "execution_plan", "turn_id": turn_id, "session_id": session_id, "plan": plan, **plan}
        except Exception as e:
            yield {
                "type": "execution_plan",
                "turn_id": turn_id,
                "session_id": session_id,
                "error": f"执行计划生成失败: {friendly_api_error(e)}",
            }

    # ─── 2. 准备系统提示和上下文 ─────────────────────────
    active_names = get_active_skill_names(scope=project_id)
    system_prompt = await build_system_prompt(project_id, project_dir, active_skill_names=active_names)
    tool_runner = ToolRunner(project_id, session_id=session_id)

    # 注入激活技能的上下文
    skills_context = build_skills_context(scope=project_id)
    if skills_context:
        system_prompt = system_prompt + "\n\n" + skills_context

    # 注入相关记忆上下文
    if last_user_msg:
        try:
            memory_context = await get_contextual_memories(project_id, "", last_user_msg)
            if memory_context:
                system_prompt = system_prompt + "\n\n" + memory_context
        except Exception:
            pass

    # 检测任务类型
    task_type = detect_task_type(messages[-1].get("content", "") if messages else "")
    model_config = get_model_config(task_type)

    # 构建完整消息列表并压缩
    full_messages = [{"role": "system", "content": system_prompt}] + [
        {**m, "role": "assistant"} if m.get("role") == "model" else m for m in messages
    ]
    token_budget = settings.context_token_limit // 4
    full_messages = compress_messages(full_messages, token_budget=token_budget)

    final_content = ""
    pending_approval_count = 0

    # ─── 3. ReAct 循环 ───────────────────────────────────
    for iteration in range(MAX_ITERATIONS):
        if iteration == _ITERATION_WARNING_THRESHOLD:
            yield {"type": "warning", "message": f"已超过{_ITERATION_WARNING_THRESHOLD}轮迭代，任务可能过于复杂"}

        # 每轮迭代重置错误追踪器
        tool_runner.reset_error_tracker()

        # 问卷暂停检查：如果有活跃问卷，暂停循环等待用户回答
        from core.tools.questionnaire_tools import has_active_questionnaire, get_active_questionnaire
        if await has_active_questionnaire(project_id, session_id=session_id):
            questionnaire = await get_active_questionnaire(project_id, session_id=session_id)
            yield {"type": "questionnaire", "questionnaire": questionnaire}
            return

        # 调用LLM
        try:
            active_names = get_active_skill_names(scope=project_id)
            tool_definitions = get_all_tool_definitions(active_skill_names=active_names)
            openai_tools = _tool_defs_to_openai(tool_definitions)
            _tools_param = openai_tools if openai_tools else None
            response = await provider.chat_with_tools(
                messages=full_messages,
                tools=_tools_param,
                temperature=model_config.temperature,
                max_tokens=model_config.max_tokens,
            )
        except Exception as e:
            logger.exception("AI call failed during agent run")
            yield {"type": "error", "error": f"AI调用失败: {friendly_api_error(e)}"}
            return

        content = response.get("content")
        reasoning_content = response.get("reasoning_content", "")
        tool_calls_data = response.get("tool_calls")
        finish_reason = response.get("finish_reason")

        # 截断保护：finish_reason='length' 表示输出被截断
        if finish_reason == "length":
            if tool_calls_data:
                try:
                    json.dumps(tool_calls_data)
                except (json.JSONDecodeError, TypeError):
                    full_messages.append({
                        "role": "tool",
                        "tool_call_id": "truncation_retry",
                        "content": "输出被截断，工具参数不完整，请精简后重试。",
                    })
                    continue
            elif content:
                final_content = _sanitize_user_visible_content(content)
                if final_content:
                    yield {"type": "delta", "content": final_content}
                yield {"type": "done", "content": final_content, "is_partial": True}
                return

        if reasoning_content:
            yield {"type": "reasoning_delta", "content": reasoning_content}

        if content:
            content, tag_reasoning = split_model_output(content)
            if tag_reasoning:
                yield {"type": "reasoning_delta", "content": tag_reasoning}
            if tool_calls_data:
                content = _strip_raw_tool_call_json(content)
            thinking, cleaned_content = _extract_thinking(content)
            if thinking:
                yield {"type": "thinking", "intent": thinking["intent"], "plan": thinking["plan"], "reflection": thinking["reflection"]}
            if cleaned_content and not tool_calls_data:
                visible_content = _sanitize_user_visible_content(cleaned_content)
                if visible_content:
                    final_content = visible_content
                    yield {"type": "delta", "content": visible_content}

        # 没有工具调用 → 最终回复
        if not tool_calls_data:
            if not final_content and pending_approval_count:
                final_content = "已生成待审批变更，请在审批面板查看。"
                yield {"type": "delta", "content": final_content}
            yield {
                "type": "done",
                "content": final_content,
                "debug": {
                    "total_iterations": iteration + 1,
                    "total_tool_calls": tool_runner.total_tool_calls,
                    "message_count": len(full_messages),
                },
            }
            return

        # ─── 4. 处理工具调用 ─────────────────────────────
        assistant_msg: dict[str, Any] = {"role": "assistant"}
        if content:
            assistant_msg["content"] = content
        assistant_msg["tool_calls"] = [
            {"id": tc["id"], "type": "function", "function": {"name": tc["name"], "arguments": json.dumps(tc["arguments"], ensure_ascii=False)}}
            for tc in tool_calls_data
        ]
        full_messages.append(assistant_msg)
        yield {"type": "history", "message": assistant_msg}

        # 构建 ToolCall 列表，分离内部工具和外部工具
        all_tool_calls = []
        internal_calls = []
        external_calls = []

        for tc_data in tool_calls_data:
            tool_args = tc_data["arguments"] if isinstance(tc_data.get("arguments"), dict) else {}
            tc = ToolCall(
                id=tc_data.get("id", str(uuid.uuid4())[:8]),
                name=tc_data["name"],
                arguments=tool_args,
            )
            all_tool_calls.append(tc)
            if tc.name in INTERNAL_TOOL_NAMES:
                internal_calls.append(tc)
            else:
                external_calls.append(tc)

        # 处理内部工具（静默，不显示给用户）
        for tc in internal_calls:
            # 生成成功响应
            tool_msg = {
                "role": "tool",
                "tool_call_id": tc.id,
                "content": json.dumps({"result": "ok"}, ensure_ascii=False),
            }
            full_messages.append(tool_msg)
            yield {"type": "history", "message": tool_msg}

        # 如果只有内部工具没有外部工具，继续循环
        if not external_calls:
            continue

        # yield 外部工具的 tool_start 事件
        for tc in external_calls:
            yield {"type": "tool_start", "name": tc.name, "args": tc.arguments}

        # 并发执行外部工具
        results = await tool_runner.run_concurrent(external_calls)

        # 处理结果
        for tc, result in zip(external_calls, results):
            # 检查熔断器
            if tool_runner.is_circuit_broken():
                yield {"type": "error", "error": "工具连续失败，已停止执行"}
                yield {"type": "done", "content": final_content or "抱歉，工具执行出现问题，请重试。"}
                return

            # 处理 final_answer：提取内容并终止循环
            if tc.name == "final_answer" and result.status == ToolResultStatus.EXECUTED:
                tool_msg = {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result.result or {"result": "ok"}, ensure_ascii=False),
                }
                full_messages.append(tool_msg)
                yield {"type": "history", "message": tool_msg}
                answer_text = ""
                if isinstance(result.result, dict):
                    answer_text = result.result.get("message", "") or result.result.get("answer", "")
                else:
                    answer_text = str(result.result) if result.result else ""
                if answer_text:
                    final_content = _sanitize_user_visible_content(answer_text)
                if final_content:
                    yield {"type": "delta", "content": final_content}
                yield {
                    "type": "done",
                    "content": final_content,
                    "debug": {
                        "total_iterations": iteration + 1,
                        "total_tool_calls": tool_runner.total_tool_calls,
                        "message_count": len(full_messages),
                    },
                }
                return

            # 处理需要审批的情况 — 乐观继续，不中断推理链
            if result.status == ToolResultStatus.APPROVAL_REQUIRED and result.pending_change:
                pending_approval_count += 1
                pc = result.pending_change
                diff_text = generate_diff(pc.original_content, pc.new_content, pc.file_path)
                pc_dict = {
                    "id": pc.id,
                    "tool_name": pc.tool_name,
                    "file_path": pc.file_path,
                    "description": pc.description,
                    "diff": diff_text,
                    "original_content": pc.original_content,
                    "new_content": pc.new_content,
                    "metadata": pc.metadata or {},
                }
                yield {"type": "approval_required", "pending_change": pc_dict}

                # Shadow Read：给 LLM 完整的待审批内容
                shadow_content = pc.new_content or ""
                if settings.enable_shadow_read and len(shadow_content) > 5000:
                    shadow_preview = (
                        shadow_content[:2000] +
                        f"\n\n... [内容截断，共 {len(shadow_content)} 字符] ...\n\n" +
                        shadow_content[-1000:]
                    )
                else:
                    shadow_preview = shadow_content

                tool_result_msg = (
                    f"✅ 文件 \"{pc.file_path}\" 的变更已排队等待用户审批。\n"
                    f"操作: {pc.description}\n\n"
                    f"## 待审批内容（Shadow Read）\n"
                    f"以下是你要写入的完整内容，用户审批后会写入文件：\n\n"
                    f"```markdown\n{shadow_preview}\n```\n\n"
                    f"请继续执行其他任务，假设此变更会被批准。"
                )
                tool_msg = {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": tool_result_msg,
                }
                full_messages.append(tool_msg)
                yield {"type": "history", "message": tool_msg}
                continue

            # 处理执行结果
            if result.status == ToolResultStatus.ERROR:
                tool_result_content = f"错误: {result.error}"
                tool_result_content += _missing_file_questionnaire_hint(tc, result.error or "")
            else:
                tool_result_content = json.dumps(result.result, ensure_ascii=False) if result.result else "执行成功"

            if tc.name == "manageTodos" and result.status == ToolResultStatus.EXECUTED and isinstance(result.result, dict):
                yield {"type": "todo", "items": result.result.get("todos", [])}

            yield {"type": "tool_result", "name": tc.name, "result": result.result if result.status == ToolResultStatus.EXECUTED else {"error": result.error}}

            tool_msg = {
                "role": "tool",
                "tool_call_id": tc.id,
                "content": tool_result_content,
            }
            full_messages.append(tool_msg)
            yield {"type": "history", "message": tool_msg}

    # 循环结束，如果 final_content 为空但有工具调用结果，让模型基于结果生成回复
    if not final_content:
        has_tool_results = any(m.get("role") == "tool" for m in full_messages)
        if has_tool_results:
            full_messages.append({"role": "user", "content": "请基于上面的工具执行结果，用中文直接回答用户的问题。不要调用任何工具，直接输出文字回复。"})
            try:
                summary_resp = await provider.chat_with_tools(
                    messages=full_messages,
                    tools=[],
                    temperature=model_config.temperature,
                    max_tokens=model_config.max_tokens,
                )
                summary_content = summary_resp.get("content") or ""
                summary_content, _ = split_model_output(summary_content)
                summary_content = _sanitize_user_visible_content(summary_content)
                if summary_content:
                    final_content = summary_content
                    yield {"type": "delta", "content": final_content}
            except Exception:
                pass

    # 超过最大迭代次数
    fallback_content = "已生成待审批变更，请在审批面板查看。" if pending_approval_count else "已达到最大迭代次数，请继续提问。"
    yield {"type": "done", "content": _sanitize_user_visible_content(final_content) or fallback_content}
