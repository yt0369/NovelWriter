"""
问卷工具：Agent 可向用户提出结构化问题。
对标 NovelIDE 的 ask_questions 工具。
"""
import json
import time
import uuid
from models.tools import ToolDefinition, ToolFunction, ToolCall, ToolResult, ToolResultStatus
from db.database import get_db

# 兼容层缓存：真实状态以数据库为准。
_active_questionnaires: dict[tuple[str, str], dict] = {}


def _session_key(project_id: str, session_id: str = "") -> tuple[str, str]:
    return (project_id, session_id or "")


def _json_loads(text: str | None, fallback):
    if not text:
        return fallback
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return fallback


def _row_to_questionnaire(row) -> dict:
    item = dict(row)
    item["questions"] = _json_loads(item.get("questions"), [])
    item["answers"] = _json_loads(item.get("answers"), {})
    return item


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


async def get_active_questionnaire(project_id: str, session_id: str = "") -> dict | None:
    """获取当前活跃的问卷。"""
    db = await get_db(project_id)
    try:
        if session_id:
            rows = await db.execute_fetchall(
                """SELECT * FROM questionnaires
                   WHERE project_id = ? AND session_id = ? AND status = 'active'
                   ORDER BY updated_at DESC LIMIT 1""",
                (project_id, session_id),
            )
        else:
            rows = await db.execute_fetchall(
                """SELECT * FROM questionnaires
                   WHERE project_id = ? AND status = 'active'
                   ORDER BY updated_at DESC LIMIT 1""",
                (project_id,),
            )
        if rows:
            questionnaire = _row_to_questionnaire(rows[0])
            _active_questionnaires[_session_key(project_id, questionnaire.get("session_id", ""))] = questionnaire
            return questionnaire
    finally:
        await db.close()

    cached = _active_questionnaires.get(_session_key(project_id, session_id))
    return cached if cached and cached.get("status") == "active" else None


async def answer_questionnaire(project_id: str, answers: dict, session_id: str = "") -> dict | None:
    """提交问卷答案，返回问卷数据。"""
    q = await get_active_questionnaire(project_id, session_id)
    if not q:
        return None
    q["status"] = "completed"
    q["answers"] = answers
    q_session_id = q.get("session_id", session_id or "")
    now = int(time.time())
    db = await get_db(project_id)
    try:
        await db.execute(
            """UPDATE questionnaires
               SET answers = ?, status = 'completed', updated_at = ?
               WHERE project_id = ? AND id = ?""",
            (json.dumps(answers, ensure_ascii=False), now, project_id, q["id"]),
        )
        await db.commit()
    finally:
        await db.close()
    _active_questionnaires.pop(_session_key(project_id, q_session_id), None)
    return q


async def clear_questionnaire(project_id: str, session_id: str = ""):
    """清除活跃问卷。"""
    now = int(time.time())
    db = await get_db(project_id)
    try:
        if session_id:
            await db.execute(
                """UPDATE questionnaires
                   SET status = 'completed', updated_at = ?
                   WHERE project_id = ? AND session_id = ? AND status = 'active'""",
                (now, project_id, session_id),
            )
        else:
            await db.execute(
                """UPDATE questionnaires
                   SET status = 'completed', updated_at = ?
                   WHERE project_id = ? AND status = 'active'""",
                (now, project_id),
            )
        await db.commit()
    finally:
        await db.close()

    if session_id:
        _active_questionnaires.pop(_session_key(project_id, session_id), None)
    else:
        for key in [key for key in _active_questionnaires if key[0] == project_id]:
            _active_questionnaires.pop(key, None)


async def has_active_questionnaire(project_id: str, session_id: str = "") -> bool:
    """检查是否有活跃问卷。"""
    q = await get_active_questionnaire(project_id, session_id)
    return q is not None and q.get("status") == "active"


async def execute(tool_call: ToolCall, project_id: str, session_id: str = "") -> ToolResult:
    args = tool_call.arguments
    questions = args.get("questions", [])

    if not questions:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name="ask_questions", error="questions 不能为空")

    # 验证问题格式
    for q in questions:
        if not q.get("id") or not q.get("question"):
            return ToolResult(status=ToolResultStatus.ERROR, tool_name="ask_questions", error="每个问题必须有 id 和 question")

    questionnaire_id = str(uuid.uuid4())[:8]
    now = int(time.time())
    questionnaire = {
        "id": questionnaire_id,
        "project_id": project_id,
        "session_id": session_id or "",
        "questions": questions,
        "status": "active",
        "answers": {},
        "created_at": now,
        "updated_at": now,
    }

    db = await get_db(project_id)
    try:
        await db.execute(
            """UPDATE questionnaires
               SET status = 'completed', updated_at = ?
               WHERE project_id = ? AND session_id = ? AND status = 'active'""",
            (now, project_id, session_id or ""),
        )
        await db.execute(
            """INSERT INTO questionnaires
               (id, project_id, session_id, questions, answers, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'active', ?, ?)""",
            (
                questionnaire_id,
                project_id,
                session_id or "",
                json.dumps(questions, ensure_ascii=False),
                "{}",
                now,
                now,
            ),
        )
        await db.commit()
    finally:
        await db.close()

    _active_questionnaires[_session_key(project_id, session_id)] = questionnaire

    return ToolResult(
        status=ToolResultStatus.EXECUTED,
        tool_name="ask_questions",
        result={
            "questionnaire_id": questionnaire_id,
            "status": "active",
            "message": "问卷已创建，等待用户回答。",
        },
    )
