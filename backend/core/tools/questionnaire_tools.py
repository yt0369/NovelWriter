"""
问卷工具：Agent 可向用户提出结构化问题。
对标 NovelIDE 的 ask_questions 工具。
"""
import uuid
from models.tools import ToolDefinition, ToolFunction, ToolCall, ToolResult, ToolResultStatus

# 活跃问卷存储（按 project_id 隔离）
_active_questionnaires: dict[str, dict] = {}


def get_tool_definitions() -> list[ToolDefinition]:
    return [
        ToolDefinition(function=ToolFunction(
            name="ask_questions",
            description="向用户提出结构化问题。暂停对话直到用户回答。用于需要用户做选择或提供信息的场景。",
            parameters={
                "type": "object",
                "properties": {
                    "questions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string", "description": "问题 ID"},
                                "question": {"type": "string", "description": "问题文本"},
                                "options": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "label": {"type": "string", "description": "选项标签"},
                                            "description": {"type": "string", "description": "选项描述"},
                                            "recommended": {"type": "boolean", "description": "是否推荐"},
                                        },
                                        "required": ["label"],
                                    },
                                    "description": "选项列表",
                                },
                                "type": {
                                    "type": "string",
                                    "enum": ["single", "multi"],
                                    "description": "单选或多选，默认 single",
                                },
                            },
                            "required": ["id", "question"],
                        },
                        "description": "问题列表",
                    },
                },
                "required": ["questions"],
            },
        )),
    ]


def get_active_questionnaire(project_id: str) -> dict | None:
    """获取当前活跃的问卷。"""
    return _active_questionnaires.get(project_id)


def answer_questionnaire(project_id: str, answers: dict) -> dict | None:
    """提交问卷答案，返回问卷数据。"""
    q = _active_questionnaires.get(project_id)
    if not q:
        return None
    q["status"] = "completed"
    q["answers"] = answers
    return q


def clear_questionnaire(project_id: str):
    """清除活跃问卷。"""
    _active_questionnaires.pop(project_id, None)


def has_active_questionnaire(project_id: str) -> bool:
    """检查是否有活跃问卷。"""
    q = _active_questionnaires.get(project_id)
    return q is not None and q.get("status") == "active"


async def execute(tool_call: ToolCall, project_id: str) -> ToolResult:
    args = tool_call.arguments
    questions = args.get("questions", [])

    if not questions:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name="ask_questions", error="questions 不能为空")

    # 验证问题格式
    for q in questions:
        if not q.get("id") or not q.get("question"):
            return ToolResult(status=ToolResultStatus.ERROR, tool_name="ask_questions", error="每个问题必须有 id 和 question")

    questionnaire_id = str(uuid.uuid4())[:8]
    questionnaire = {
        "id": questionnaire_id,
        "questions": questions,
        "status": "active",
        "answers": {},
    }

    _active_questionnaires[project_id] = questionnaire

    return ToolResult(
        status=ToolResultStatus.EXECUTED,
        tool_name="ask_questions",
        result={
            "questionnaire_id": questionnaire_id,
            "status": "active",
            "message": "问卷已创建，等待用户回答。",
        },
    )
