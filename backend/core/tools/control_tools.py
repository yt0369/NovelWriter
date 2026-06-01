import uuid
from typing import Any

from models.tools import ToolDefinition, ToolFunction, ToolCall, ToolResult, ToolResultStatus


def get_control_tool_definitions() -> list[ToolDefinition]:
    return [
        ToolDefinition(function=ToolFunction(
            name="thinking",
            description="内部思考（不显示给用户）",
            parameters={"type": "object", "properties": {
                "thought": {"type": "string", "description": "思考内容"},
            }, "required": ["thought"]},
        )),
        ToolDefinition(function=ToolFunction(
            name="final_answer",
            description="给出最终回复（结束本轮对话）",
            parameters={"type": "object", "properties": {
                "message": {"type": "string", "description": "回复内容"},
            }, "required": ["message"]},
        )),
        # ask_questions 已移至 questionnaire_tools.py，避免重复定义
        ToolDefinition(function=ToolFunction(
            name="reflection",
            description="""[内部反思工具] 在关键节点暂停并深度反思。可以多次调用形成思维链，每次反思必须有具体发现。

什么时候必须调用：
1. 执行完复杂操作/大型工具后 — 检查结果是否符合预期
2. 收到用户反馈后 — 分析用户的真实意图和情绪
3. 最终回复前 — 检查回复是否完整、准确
4. 发现前后矛盾时 — 回溯检查哪里出了问题
5. 方向不确定时 — 判断当前路径是否正确

什么时候可以跳过：简单的一轮一问一答、闲聊或简单确认。""",
            parameters={"type": "object", "properties": {
                "focus": {"type": "string", "enum": ["operation_result", "user_feedback", "final_check", "contradiction", "direction"], "description": "反思焦点：operation_result=操作结果检查 | user_feedback=用户反馈分析 | final_check=最终回复前检查 | contradiction=矛盾回溯 | direction=方向判断"},
                "observation": {"type": "string", "description": "观察：你看到了什么具体事实/结果/反馈？只陈述事实。"},
                "analysis": {"type": "string", "description": "分析：这意味着什么？用户的真实意图是什么？操作结果是否符合预期？"},
                "conclusion": {"type": "string", "description": "结论：接下来应该怎么做？需要调整方向吗？给出明确的行动建议。"},
                "confidence": {"type": "number", "description": "你对这个结论的置信度 0-1。低置信度（<0.7）说明需要再次反思或向用户澄清。"},
            }, "required": ["focus", "observation", "analysis", "conclusion"]},
        )),
    ]


async def execute_control_tool(tool_call: ToolCall) -> ToolResult:
    name = tool_call.name
    args = tool_call.arguments if isinstance(tool_call.arguments, dict) else {}

    if name == "thinking":
        thought = args.get("thought") or args.get("content") or args.get("text") or ""
        if not thought and isinstance(args, dict):
            thought = next(iter(args.values()), "") if args else ""
        return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"thought": str(thought)})

    elif name == "final_answer":
        message = args.get("message") or args.get("answer") or args.get("content") or ""
        return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={"message": str(message)})

    elif name == "reflection":
        # 支持新格式（结构化反思）和旧格式（简单 thought）
        focus = args.get("focus", "")
        if focus:
            result = {
                "focus": focus,
                "observation": args.get("observation", ""),
                "analysis": args.get("analysis", ""),
                "conclusion": args.get("conclusion", ""),
                "confidence": args.get("confidence", 0.8),
                "silent": True,
            }
        else:
            thought = args.get("thought") or ""
            result = {"thought": str(thought), "silent": True}
        return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result=result)

    return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"未知工具: {name}")
