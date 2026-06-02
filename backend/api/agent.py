import json
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import settings
from db.database import get_db
from ai.openai_provider import OpenAIProvider
from core.agent.engine import run_agent, _sanitize_user_visible_content
from core.agent.execution_plan import build_agent_execution_plan
from core.agent.intent import build_intent_preview
from core.pending_changes import (
    FileSafetyError,
    approve_pending_change,
    list_pending_changes,
    reject_pending_change,
    revise_pending_change,
    update_pending_change_edit_status,
)
from utils.diff import generate_diff

router = APIRouter()
provider = OpenAIProvider()


class ChatRequest(BaseModel):
    project_id: str
    session_id: str
    message: str


class IntentPreviewRequest(BaseModel):
    message: str
    chapter_index: int | None = None
    title: str = ""
    active_file_path: str = ""


def _json_dumps(data) -> str:
    return json.dumps(data, ensure_ascii=False)


def _json_loads(text: str | None, fallback):
    if not text:
        return fallback
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return fallback


async def _save_chat_message(
    project_id: str,
    session_id: str,
    role: str,
    content: str,
    raw_parts: dict | None = None,
    metadata: dict | None = None,
):
    now = int(time.time() * 1000)
    db = await get_db(project_id)
    try:
        await db.execute(
            """INSERT INTO chat_messages (id, session_id, role, content, raw_parts, metadata, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                str(uuid.uuid4())[:8],
                session_id,
                role,
                content,
                _json_dumps(raw_parts or {}) if raw_parts is not None else None,
                _json_dumps(metadata or {}) if metadata is not None else None,
                now,
            ),
        )
        await db.execute(
            "UPDATE chat_sessions SET last_modified = ? WHERE id = ? AND project_id = ?",
            (now, session_id, project_id),
        )
        await db.commit()
    finally:
        await db.close()


def _row_to_client_message(row) -> dict:
    item = dict(row)
    raw_parts = _json_loads(item.get("raw_parts"), {})
    metadata = _json_loads(item.get("metadata"), {})
    item["raw_parts"] = raw_parts
    item["metadata"] = metadata
    if isinstance(raw_parts, dict):
        item["reasoning_content"] = raw_parts.get("reasoning_content", "")
    return item


async def _load_chat_messages(project_id: str, session_id: str) -> list[dict]:
    db = await get_db(project_id)
    try:
        rows = await db.execute_fetchall(
            "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp",
            (session_id,),
        )
        return [_row_to_client_message(r) for r in rows]
    finally:
        await db.close()


async def _load_client_chat_messages(project_id: str, session_id: str) -> list[dict]:
    rows = await _load_chat_messages(project_id, session_id)
    visible: list[dict] = []
    for row in rows:
        role = row.get("role")
        if role not in {"user", "model", "system"}:
            continue
        item = dict(row)
        if role == "model":
            item["content"] = _sanitize_user_visible_content(item.get("content", ""))
            if not item["content"] and not item.get("reasoning_content"):
                continue
        visible.append(item)
    return visible


async def _load_agent_history(project_id: str, session_id: str) -> list[dict]:
    rows = await _load_chat_messages(project_id, session_id)
    history = []
    for row in rows:
        role = row.get("role")
        content = row.get("content", "")
        raw_parts = row.get("raw_parts") or {}

        if role == "assistant":
            msg = {"role": "assistant", "content": content}
            if isinstance(raw_parts, dict) and raw_parts.get("tool_calls"):
                msg["tool_calls"] = raw_parts["tool_calls"]
            history.append(msg)
        elif role == "tool":
            if not isinstance(raw_parts, dict):
                continue
            tool_call_id = raw_parts.get("tool_call_id")
            if not tool_call_id:
                continue
            history.append({"role": "tool", "tool_call_id": tool_call_id, "content": content})
        elif role == "model":
            history.append({"role": "assistant", "content": content})
        elif role in {"user", "system"}:
            history.append({"role": role, "content": content})
    return history


async def _save_agent_history_message(project_id: str, session_id: str, message: dict):
    role = message.get("role", "")
    if role not in {"assistant", "tool"}:
        return
    await _save_chat_message(
        project_id,
        session_id,
        role,
        message.get("content", ""),
        raw_parts=message,
        metadata={"source": "agent_history"},
    )


async def _update_chat_message_content(project_id: str, session_id: str, message_id: str, content: str) -> dict:
    db = await get_db(project_id)
    now = int(time.time() * 1000)
    try:
        rows = await db.execute_fetchall(
            """SELECT m.* FROM chat_messages m
               JOIN chat_sessions s ON s.id = m.session_id
               WHERE m.id = ? AND m.session_id = ? AND s.project_id = ?""",
            (message_id, session_id, project_id),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="消息不存在")

        row = dict(rows[0])
        raw_parts = _json_loads(row.get("raw_parts"), {})
        metadata = _json_loads(row.get("metadata"), {})
        role = row.get("role", "")
        if role not in {"user", "model", "assistant", "system"}:
            raise HTTPException(status_code=400, detail=f"{role} 消息不能直接编辑")
        if isinstance(raw_parts, dict):
            raw_parts["content"] = content
            if role == "assistant" and raw_parts.get("role") == "assistant":
                raw_parts["content"] = content

        metadata["edited_at"] = now
        await db.execute(
            "UPDATE chat_messages SET content = ?, raw_parts = ?, metadata = ? WHERE id = ? AND session_id = ?",
            (
                content,
                _json_dumps(raw_parts) if raw_parts else row.get("raw_parts"),
                _json_dumps(metadata),
                message_id,
                session_id,
            ),
        )
        await db.execute(
            "UPDATE chat_sessions SET last_modified = ? WHERE id = ? AND project_id = ?",
            (now, session_id, project_id),
        )
        await db.commit()
    finally:
        await db.close()

    messages = await _load_chat_messages(project_id, session_id)
    for message in messages:
        if message.get("id") == message_id:
            return message
    raise HTTPException(status_code=404, detail="消息不存在")


async def _truncate_chat_messages(project_id: str, session_id: str, message_id: str, inclusive: bool = False) -> dict:
    db = await get_db(project_id)
    now = int(time.time() * 1000)
    try:
        rows = await db.execute_fetchall(
            """SELECT m.rowid AS row_id FROM chat_messages m
               JOIN chat_sessions s ON s.id = m.session_id
               WHERE m.id = ? AND m.session_id = ? AND s.project_id = ?""",
            (message_id, session_id, project_id),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="消息不存在")

        row_id = rows[0]["row_id"]
        op = ">=" if inclusive else ">"
        cursor = await db.execute(
            f"DELETE FROM chat_messages WHERE session_id = ? AND rowid {op} ?",
            (session_id, row_id),
        )
        await db.execute(
            "UPDATE chat_sessions SET last_modified = ? WHERE id = ? AND project_id = ?",
            (now, session_id, project_id),
        )
        await db.commit()
        deleted = cursor.rowcount if cursor.rowcount is not None else 0
    finally:
        await db.close()
    return {"ok": True, "deleted": deleted, "inclusive": inclusive}


# ─── SSE 端点（基础聊天，无工具） ──────────────────────────

@router.post("/{project_id}/intent-preview")
async def intent_preview(project_id: str, req: IntentPreviewRequest):
    project_dir = settings.projects_dir / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="项目不存在")
    return await build_intent_preview(
        req.message,
        provider,
        chapter_index=req.chapter_index,
        title=req.title,
        active_file_path=req.active_file_path,
    )


@router.post("/{project_id}/execution-plan")
async def execution_plan(project_id: str, req: IntentPreviewRequest):
    project_dir = settings.projects_dir / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="项目不存在")
    return await build_agent_execution_plan(
        project_id,
        req.message,
        provider,
        chapter_index=req.chapter_index,
        title=req.title,
        active_file_path=req.active_file_path,
    )


@router.post("/chat")
async def chat(req: ChatRequest):
    await _save_chat_message(req.project_id, req.session_id, "user", req.message)
    messages = await _load_agent_history(req.project_id, req.session_id)

    async def event_stream():
        full_response = ""
        reasoning_content = ""
        async for event in provider.chat_stream_events(messages):
            if event["type"] == "reasoning_delta":
                reasoning_content += event["content"]
            elif event["type"] == "delta":
                full_response += event["content"]
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

        await _save_chat_message(
            req.project_id,
            req.session_id,
            "model",
            full_response,
            raw_parts={"content": full_response, "reasoning_content": reasoning_content},
            metadata={"model": settings.model, "has_reasoning": bool(reasoning_content)},
        )

        yield f"data: {json.dumps({'type': 'done', 'content': full_response, 'reasoning_content': reasoning_content}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ─── WebSocket 端点（Agent模式，带工具+审批） ──────────────

@router.websocket("/ws/agent/{project_id}/{session_id}")
async def agent_ws(ws: WebSocket, project_id: str, session_id: str):
    await ws.accept()
    project_dir = settings.projects_dir / project_id

    if not project_dir.exists():
        await ws.send_json({"type": "error", "error": "项目不存在"})
        await ws.close()
        return

    chat_messages = await _load_agent_history(project_id, session_id)

    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type", "chat")

            if msg_type == "chat":
                user_text = data.get("message", "")
                active_file_path = data.get("active_file_path", "")
                turn_id = data.get("turn_id", 0)
                reuse_last_user = bool(data.get("reuse_last_user"))
                if not user_text:
                    continue

                # 检查是否是问卷答案
                is_questionnaire_answer = False
                try:
                    parsed = json.loads(user_text)
                    if isinstance(parsed, dict) and parsed.get("type") == "questionnaire_answer":
                        from core.tools.questionnaire_tools import answer_questionnaire
                        answers = parsed.get("answers", {})
                        q_result = await answer_questionnaire(project_id, answers, session_id=session_id)
                        # 将答案格式化为用户消息
                        answer_lines = []
                        for q_id, ans in answers.items():
                            answer_lines.append(f"- {q_id}: {ans}")
                        user_text = f"[问卷回答]\n" + "\n".join(answer_lines)
                        is_questionnaire_answer = True
                except (json.JSONDecodeError, TypeError):
                    pass

                if reuse_last_user:
                    chat_messages = await _load_agent_history(project_id, session_id)
                    if not chat_messages or chat_messages[-1].get("role") != "user":
                        chat_messages.append({"role": "user", "content": user_text})
                    elif chat_messages[-1].get("content") != user_text:
                        chat_messages[-1] = {"role": "user", "content": user_text}
                else:
                    await _save_chat_message(project_id, session_id, "user", user_text)
                    chat_messages.append({"role": "user", "content": user_text})
                turn_messages = [{"role": "user", "content": user_text}]

                # 运行Agent引擎
                full_response = ""
                reasoning_content = ""
                async for event in run_agent(chat_messages, provider, project_id, project_dir, active_file_path=active_file_path, turn_id=turn_id, session_id=session_id):
                    etype = event.get("type")

                    if etype == "delta":
                        full_response += event.get("content", "")
                        await ws.send_json(event)

                    elif etype == "reasoning_delta":
                        reasoning_content += event.get("content", "")
                        await ws.send_json(event)

                    elif etype == "thinking":
                        await ws.send_json(event)

                    elif etype == "intent":
                        await ws.send_json(event)

                    elif etype == "execution_plan":
                        plan = event.get("plan")
                        if isinstance(plan, dict):
                            try:
                                from api.plans import persist_execution_plan
                                await persist_execution_plan(project_id, session_id, plan)
                            except Exception:
                                pass
                        await ws.send_json(event)

                    elif etype == "history":
                        history_message = event.get("message", {})
                        if isinstance(history_message, dict):
                            await _save_agent_history_message(project_id, session_id, history_message)
                            chat_messages.append(history_message)
                            turn_messages.append(history_message)

                    elif etype == "tool_start":
                        await ws.send_json(event)

                    elif etype == "tool_result":
                        await ws.send_json(event)

                    elif etype == "approval_required":
                        await ws.send_json(event)

                    elif etype == "questionnaire":
                        # 问卷暂停，发送给前端并等待回答
                        await ws.send_json(event)

                    elif etype == "done":
                        full_response = event.get("content", full_response)
                        # 保存模型回复
                        reasoning_content = event.get("reasoning_content", reasoning_content)
                        if full_response or reasoning_content:
                            await _save_chat_message(
                                project_id,
                                session_id,
                                "model",
                                full_response,
                                raw_parts={"content": full_response, "reasoning_content": reasoning_content},
                                metadata={"model": settings.model, "has_reasoning": bool(reasoning_content)},
                            )
                            model_message = {"role": "assistant", "content": full_response}
                            chat_messages.append(model_message)
                            turn_messages.append(model_message)
                        if settings.auto_extract_conversation:
                            try:
                                from core.memory.stack import extract_conversation_knowledge
                                extracted = await extract_conversation_knowledge(turn_messages, project_id, session_id)
                                if extracted:
                                    await ws.send_json({"type": "knowledge_extracted", "items": extracted, "count": len(extracted)})
                            except Exception:
                                pass
                        await ws.send_json({"type": "done", "content": full_response, "reasoning_content": reasoning_content})

                    elif etype == "error":
                        await ws.send_json(event)

            elif msg_type == "approve":
                change_id = data.get("change_id", "")
                try:
                    result = await approve_pending_change(project_id, change_id, source="agent")
                except FileSafetyError as e:
                    await ws.send_json({"type": "error", "error": str(e)})
                    continue
                # 乐观继续模式：引擎已在审批请求后继续运行，无需重启
                await ws.send_json({
                    "type": "approval_result",
                    "change_id": change_id,
                    "status": "approved",
                    "result": result,
                })

            elif msg_type == "reject":
                change_id = data.get("change_id", "")
                try:
                    await reject_pending_change(project_id, change_id)
                except FileSafetyError as e:
                    await ws.send_json({"type": "error", "error": str(e)})
                    continue
                await ws.send_json({
                    "type": "approval_result",
                    "change_id": change_id,
                    "status": "rejected",
                })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await ws.send_json({"type": "error", "error": str(e)})
        except Exception:
            pass


@router.get("/{project_id}/pending-changes")
async def get_pending_changes(project_id: str):
    changes = await list_pending_changes(project_id)
    for change in changes:
        change["diff"] = generate_diff(change["original_content"], change["new_content"], change["file_path"])
    return changes


@router.get("/{project_id}/questionnaire")
async def get_active_questionnaire(project_id: str, session_id: str = ""):
    from core.tools.questionnaire_tools import get_active_questionnaire as get_questionnaire

    questionnaire = await get_questionnaire(project_id, session_id=session_id)
    if questionnaire and questionnaire.get("status") == "active":
        return questionnaire
    return None


class RevisePendingChangeRequest(BaseModel):
    new_content: str
    description: str | None = None


class UpdatePendingEditRequest(BaseModel):
    status: str


class UpdateChatMessageRequest(BaseModel):
    content: str


class TruncateChatMessagesRequest(BaseModel):
    inclusive: bool = False


@router.post("/{project_id}/pending-changes/{change_id}/approve")
async def approve_change(project_id: str, change_id: str):
    try:
        return await approve_pending_change(project_id, change_id, source="agent")
    except Exception as e:
        if isinstance(e, FileSafetyError):
            status_code = 404 if "未找到" in str(e) else 400
            raise HTTPException(status_code=status_code, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{project_id}/pending-changes/{change_id}/reject")
async def reject_change(project_id: str, change_id: str):
    try:
        return await reject_pending_change(project_id, change_id)
    except FileSafetyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{project_id}/pending-changes/{change_id}/revise")
async def revise_change(project_id: str, change_id: str, body: RevisePendingChangeRequest):
    try:
        pc = await revise_pending_change(project_id, change_id, body.new_content, body.description)
        return pc.model_dump()
    except FileSafetyError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{project_id}/pending-changes/{change_id}/edits/{edit_id}")
async def update_pending_edit(project_id: str, change_id: str, edit_id: str, body: UpdatePendingEditRequest):
    if body.status not in {"accepted", "rejected", "pending"}:
        raise HTTPException(status_code=400, detail="status 必须是 accepted/rejected/pending")
    try:
        pc = await update_pending_change_edit_status(project_id, change_id, edit_id, body.status)
        data = pc.model_dump()
        data["diff"] = generate_diff(pc.original_content, pc.new_content, pc.file_path)
        return data
    except FileSafetyError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─── 会话管理（保留原有端点） ──────────────────────────────

@router.get("/{project_id}/sessions")
async def list_sessions(project_id: str):
    db = await get_db(project_id)
    rows = await db.execute_fetchall(
        "SELECT * FROM chat_sessions WHERE project_id = ? ORDER BY last_modified DESC",
        (project_id,),
    )
    await db.close()
    return [dict(r) for r in rows]


@router.post("/{project_id}/sessions")
async def create_session(project_id: str, title: str = "新对话"):
    now = int(time.time())
    session_id = str(uuid.uuid4())[:8]
    db = await get_db(project_id)

    existing = await db.execute_fetchall(
        "SELECT id FROM projects WHERE id = ?", (project_id,)
    )
    if not existing:
        project_dir = settings.projects_dir / project_id
        project_name = project_dir.name
        await db.execute(
            "INSERT OR IGNORE INTO projects (id, name, description, created_at, last_modified) VALUES (?, ?, '', ?, ?)",
            (project_id, project_name, now, now),
        )

    await db.execute(
        "INSERT INTO chat_sessions (id, project_id, title, created_at, last_modified) VALUES (?, ?, ?, ?, ?)",
        (session_id, project_id, title, now, now),
    )
    await db.commit()
    await db.close()
    return {"id": session_id, "title": title, "project_id": project_id}


@router.get("/{project_id}/sessions/{session_id}/messages")
async def get_messages(project_id: str, session_id: str):
    return await _load_client_chat_messages(project_id, session_id)


@router.delete("/{project_id}/sessions/{session_id}")
async def delete_session(project_id: str, session_id: str):
    db = await get_db(project_id)
    await db.execute("DELETE FROM chat_sessions WHERE id = ? AND project_id = ?", (session_id, project_id))
    await db.commit()
    await db.close()
    return {"ok": True}


@router.patch("/{project_id}/sessions/{session_id}")
async def rename_session(project_id: str, session_id: str, body: dict):
    title = body.get("title", "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")
    db = await get_db(project_id)
    await db.execute(
        "UPDATE chat_sessions SET title = ? WHERE id = ? AND project_id = ?",
        (title, session_id, project_id),
    )
    await db.commit()
    await db.close()
    return {"ok": True, "title": title}


@router.delete("/{project_id}/sessions/{session_id}/messages/{message_id}")
async def delete_message(project_id: str, session_id: str, message_id: str):
    db = await get_db(project_id)
    await db.execute(
        "DELETE FROM chat_messages WHERE id = ? AND session_id = ?",
        (message_id, session_id),
    )
    await db.commit()
    await db.close()
    return {"ok": True}


@router.patch("/{project_id}/sessions/{session_id}/messages/{message_id}")
async def update_message(project_id: str, session_id: str, message_id: str, body: UpdateChatMessageRequest):
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="消息内容不能为空")
    return await _update_chat_message_content(project_id, session_id, message_id, content)


@router.post("/{project_id}/sessions/{session_id}/messages/{message_id}/truncate")
async def truncate_messages(project_id: str, session_id: str, message_id: str, body: TruncateChatMessagesRequest):
    return await _truncate_chat_messages(project_id, session_id, message_id, body.inclusive)


@router.delete("/{project_id}/sessions/{session_id}/messages")
async def clear_session_messages(project_id: str, session_id: str):
    db = await get_db(project_id)
    await db.execute(
        "DELETE FROM chat_messages WHERE session_id = ?",
        (session_id,),
    )
    await db.commit()
    await db.close()
    return {"ok": True}


class PolishProjectRequest(BaseModel):
    name: str = ""
    description: str = ""
    genre: str = ""
    target_chapters: int = 100
    words_per_chapter: int = 3000
    core_gameplay: list[str] = []
    narrative_elements: list[str] = []
    style_tone: list[str] = []
    romance_line: list[str] = []
    instruction: str = ""


@router.post("/polish-project")
async def polish_project(req: PolishProjectRequest):
    system_prompt = "你是一名资深小说创作顾问，专门输出 JSON 格式的小说项目设定。请只输出 JSON，不要包含 ```json 前缀。"

    user_prompt = f"""请帮我完善以下小说项目的设定。

【当前表单信息】：
- 书名：{req.name or '(未定)'}
- 题材：{req.genre or '(未定)'}
- 简介：{req.description or '(未提供)'}
- 预期章节数：{req.target_chapters}
- 单章字数：{req.words_per_chapter}
- 已选核心玩法：{'、'.join(req.core_gameplay) if req.core_gameplay else '(未选)'}
- 已选叙事元素：{'、'.join(req.narrative_elements) if req.narrative_elements else '(未选)'}
- 已选风格基调：{'、'.join(req.style_tone) if req.style_tone else '(未选)'}
- 已选感情线：{'、'.join(req.romance_line) if req.romance_line else '(未选)'}

【用户额外指令】：{req.instruction or '(无)'}

请输出纯JSON格式：
{{
  "name": "书名（保留原名或优化）",
  "description": "简介（≤300字）",
  "core_gameplay": ["标签1", "标签2"],
  "narrative_elements": ["标签1", "标签2"],
  "style_tone": ["标签1", "标签2"],
  "romance_line": ["标签1"]
}}

注意：保留用户已选标签，只补充缺失部分。"""

    try:
        result = await provider.chat(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.8,
        )

        text = result.strip()
        text = text.replace('```json', '').replace('```', '').strip()
        start = text.find('{')
        end = text.rfind('}')
        if start != -1 and end != -1:
            data = json.loads(text[start:end+1])
            return data
        return {"error": "AI返回格式异常"}
    except Exception as e:
        return {"error": str(e)}


# ─── 调试端点 ──────────────────────────────────────────────

@router.get("/debug/context/{project_id}/{session_id}")
async def debug_context(project_id: str, session_id: str):
    """返回会话的上下文调试信息。"""
    messages = await _load_agent_history(project_id, session_id)
    from core.agent.compression import compress_messages, fix_window_integrity
    from utils.token_estimator import estimate_tokens

    # 分类消息状态
    debug_messages = []
    tool_call_map = {}
    for msg in messages:
        if msg.get("role") == "assistant" and msg.get("tool_calls"):
            for tc in msg["tool_calls"]:
                func = tc.get("function", {})
                tool_call_map[tc.get("id", "")] = func.get("name", "")

    for i, msg in enumerate(messages):
        role = msg.get("role", "")
        content = msg.get("content", "")
        tool_names = []
        has_tool_result = False

        if role == "assistant" and msg.get("tool_calls"):
            tool_names = [tc.get("function", {}).get("name", "") for tc in msg["tool_calls"]]
        if role == "tool":
            has_tool_result = True
            tc_id = msg.get("tool_call_id", "")
            tool_names = [tool_call_map.get(tc_id, "unknown")]

        debug_messages.append({
            "index": i,
            "role": role,
            "content": content[:500] if content else "",
            "state": "sent",
            "tool_names": tool_names if tool_names else None,
            "has_tool_result": has_tool_result,
        })

    call_ids = set(tool_call_map.keys())
    response_ids = {m.get("tool_call_id", "") for m in messages if m.get("role") == "tool"}
    orphan_tool_calls = sorted(call_ids - response_ids)
    orphan_tool_results = sorted(response_ids - call_ids)

    token_budget = settings.context_token_limit // 4
    estimated_tokens = sum(estimate_tokens(m.get("content", "")) for m in messages)
    fixed_messages = fix_window_integrity(messages)
    compressed_messages = compress_messages(messages, token_budget=token_budget, session_id=session_id)
    compressed_tokens = sum(estimate_tokens(m.get("content", "")) for m in compressed_messages)

    return {
        "total_messages": len(messages),
        "sent_count": len(messages),
        "filtered_count": 0,
        "tool_pairs": len(tool_call_map),
        "estimated_tokens": estimated_tokens,
        "token_budget": token_budget,
        "compression_threshold": int(token_budget * 0.8),
        "over_compression_threshold": estimated_tokens > int(token_budget * 0.8),
        "compression_applied": len(compressed_messages) < len(fixed_messages) or compressed_tokens < estimated_tokens,
        "compressed_message_count": len(compressed_messages),
        "compressed_tokens": compressed_tokens,
        "fixed_message_count": len(fixed_messages),
        "orphan_tool_calls": orphan_tool_calls,
        "orphan_tool_results": orphan_tool_results,
        "messages": debug_messages,
    }
