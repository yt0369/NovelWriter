import time
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ai.compat import friendly_api_error, normalize_api_base_url, provider_hint_for
from ai.openai_provider import _retry_with_backoff
from api.agent import _load_agent_history, _load_chat_messages, _save_chat_message
from api.plans import persist_execution_plan
from api.skills import get_skill_assets
from core.agent.reasoning import ThinkStreamSplitter, split_model_output
from core.agent.context import build_system_prompt
from core.memory.stack import extract_conversation_knowledge
from core.tools import get_all_tool_definitions, execute_tool
from core.tools.evolution_tools import execute_evolution_tool
from models.tools import ToolCall, ToolResultStatus
from core.presets.definitions import GENRE_PRESETS
from core.skills.assets import (
    CORE_QUALITY_SKILL_IDS,
    list_skill_assets,
    validate_core_skill_assets,
)
from db.database import get_db
from support import ProjectTestCase


class SkillsReasoningSettingsTests(ProjectTestCase):
    async def test_migrated_skill_assets_include_key_core_skills_and_preset_packs(self):
        assets = list_skill_assets()
        paths = {item["path"] for item in assets}

        for expected in [
            "core/character_status.md",
            "core/deep_thinking.md",
            "core/draft_expander.md",
            "core/expectation_manager.md",
            "core/outline_creation.md",
            "core/pleasure_rhythm_manager.md",
            "core/project_init.md",
            "core/strand_weave.md",
            "core/constraint_layered_design.md",
            "core/dialogue_writing.md",
            "core/combat_scenes.md",
            "core/emotion_rendering.md",
            "core/scene_description.md",
            "core/text_polish.md",
            "core/editor_review.md",
            "core/core_protocol.md",
            "core/world_builder.md",
            "core/draft_writer.md",
            "core/character_designer.md",
            "presets/history_travel/topic_pack.md",
            "presets/mystery/topic_pack.md",
            "presets/scifi/topic_pack.md",
            "presets/urban/topic_pack.md",
            "presets/wuxia/topic_pack.md",
            "presets/wuxian/topic_pack.md",
            "presets/xianxia/topic_pack.md",
            "presets/xitong/topic_pack.md",
            "presets/xuanhuan/topic_pack.md",
        ]:
            self.assertIn(expected, paths)

    async def test_all_genre_presets_have_topic_pack_assets(self):
        assets = list_skill_assets()
        paths = {item["path"] for item in assets}

        for preset_id in GENRE_PRESETS:
            self.assertIn(f"presets/{preset_id}/topic_pack.md", paths)

    async def test_skill_assets_mark_project_preset_match_and_creative_reference(self):
        db = await get_db(self.project_id)
        now = int(time.time())
        await db.execute("UPDATE projects SET preset_id = 'xuanhuan' WHERE id = ?", (self.project_id,))
        await db.execute(
            """INSERT INTO project_skill_settings (id, project_id, skill_id, enabled, source, created_at, updated_at)
               VALUES ('preset-xuanhuan', ?, 'draft_writer', 1, 'preset', ?, ?)""",
            (self.project_id, now, now),
        )
        await db.commit()
        await db.close()

        assets = await get_skill_assets(self.project_id)
        by_path = {item["path"]: item for item in assets}
        xuanhuan = by_path["presets/xuanhuan/topic_pack.md"]
        yanqing = by_path["presets/yanqing/topic_pack.md"]
        core = by_path["core/draft_writer.md"]

        self.assertTrue(xuanhuan["is_preset_asset"])
        self.assertTrue(xuanhuan["matches_project_preset"])
        self.assertTrue(xuanhuan["project_enabled"])
        self.assertFalse(xuanhuan["can_be_creative_reference"])
        self.assertTrue(yanqing["is_preset_asset"])
        self.assertFalse(yanqing["matches_project_preset"])
        self.assertFalse(yanqing["project_enabled"])
        self.assertTrue(yanqing["can_be_creative_reference"])
        self.assertFalse(core["is_preset_asset"])
        self.assertTrue(core["project_enabled"])

    async def test_v21_core_skill_assets_have_quality_contract(self):
        assets = {item["id"]: item for item in list_skill_assets()}

        for skill_id in CORE_QUALITY_SKILL_IDS:
            self.assertIn(skill_id, assets)
            asset = assets[skill_id]
            self.assertTrue(asset["usage_scenarios"], skill_id)
            self.assertTrue(asset["input_requirements"], skill_id)
            self.assertTrue(asset["output_contract"], skill_id)
            self.assertTrue(asset["forbidden_rules"], skill_id)
            self.assertTrue(asset["activation_hints"], skill_id)
            self.assertFalse(asset["invalid_tools"], skill_id)
            self.assertFalse(asset["legacy_tools"], skill_id)
            self.assertGreater(asset["content_length"], 100, skill_id)

        self.assertEqual(validate_core_skill_assets(), [])

    async def test_think_tags_are_split_from_final_answer(self):
        answer, reasoning = split_model_output("<think>先分析问题</think>\n最终回答")
        self.assertEqual(answer, "最终回答")
        self.assertEqual(reasoning, "先分析问题")

    async def test_streaming_think_tags_split_across_chunks(self):
        splitter = ThinkStreamSplitter()
        events = []
        for chunk in ["<thi", "nk>先分析", "问题</thi", "nk>\n最终", "回答"]:
            events.extend(splitter.feed(chunk))
        events.extend(splitter.flush())

        reasoning = "".join(e["content"] for e in events if e["type"] == "reasoning_delta")
        answer = "".join(e["content"] for e in events if e["type"] == "delta")
        self.assertEqual(reasoning, "先分析问题")
        self.assertEqual(answer.strip(), "最终回答")

    async def test_reasoning_raw_parts_are_saved_and_loaded(self):
        db = await get_db(self.project_id)
        now = int(time.time())
        await db.execute(
            "INSERT INTO chat_sessions (id, project_id, title, created_at, last_modified) VALUES ('s1', ?, '测试会话', ?, ?)",
            (self.project_id, now, now),
        )
        await db.commit()
        await db.close()

        await _save_chat_message(
            self.project_id,
            "s1",
            "model",
            "最终回答",
            raw_parts={"content": "最终回答", "reasoning_content": "思考过程"},
            metadata={"model": "qwen3.6-max-preview-thinking", "has_reasoning": True},
        )
        messages = await _load_chat_messages(self.project_id, "s1")
        self.assertEqual(messages[0]["content"], "最终回答")
        self.assertEqual(messages[0]["reasoning_content"], "思考过程")
        self.assertTrue(messages[0]["metadata"]["has_reasoning"])

    async def test_agent_history_reconstructs_tool_pairs_from_saved_raw_parts(self):
        db = await get_db(self.project_id)
        now = int(time.time())
        await db.execute(
            "INSERT INTO chat_sessions (id, project_id, title, created_at, last_modified) VALUES ('s_tool', ?, '工具会话', ?, ?)",
            (self.project_id, now, now),
        )
        await db.commit()
        await db.close()

        assistant_msg = {
            "role": "assistant",
            "content": "",
            "tool_calls": [{
                "id": "call_1",
                "type": "function",
                "function": {"name": "read_file", "arguments": "{\"path\":\"a.md\"}"},
            }],
        }
        tool_msg = {"role": "tool", "tool_call_id": "call_1", "content": "{\"content\":\"hello\"}"}
        await _save_chat_message(self.project_id, "s_tool", "assistant", "", raw_parts=assistant_msg)
        await _save_chat_message(self.project_id, "s_tool", "tool", tool_msg["content"], raw_parts=tool_msg)

        history = await _load_agent_history(self.project_id, "s_tool")
        self.assertEqual(history[0]["role"], "assistant")
        self.assertEqual(history[0]["tool_calls"][0]["id"], "call_1")
        self.assertEqual(history[1]["role"], "tool")
        self.assertEqual(history[1]["tool_call_id"], "call_1")

    async def test_agent_history_maps_saved_model_messages_to_assistant_role(self):
        db = await get_db(self.project_id)
        now = int(time.time())
        await db.execute(
            "INSERT INTO chat_sessions (id, project_id, title, created_at, last_modified) VALUES ('s_model', ?, '模型会话', ?, ?)",
            (self.project_id, now, now),
        )
        await db.commit()
        await db.close()

        await _save_chat_message(self.project_id, "s_model", "model", "上一轮回复")

        history = await _load_agent_history(self.project_id, "s_model")
        self.assertEqual(history, [{"role": "assistant", "content": "上一轮回复"}])

    async def test_query_evolution_runs_inside_async_event_loop(self):
        record = await execute_evolution_tool(
            ToolCall(id="record", name="manage_evolution", arguments={
                "action": "record_insight",
                "content": "复杂章节先查角色状态再动笔",
                "context": "Phase A 回归测试",
                "importance": "high",
            }),
            self.project_id,
        )
        self.assertEqual(record.status, ToolResultStatus.EXECUTED)

        query = await execute_evolution_tool(
            ToolCall(id="query", name="query_evolution", arguments={
                "action": "recall",
                "query": "角色状态",
            }),
            self.project_id,
        )
        self.assertEqual(query.status, ToolResultStatus.EXECUTED)
        self.assertGreaterEqual(query.result["count"], 1)

    async def test_draft_writer_unlocks_required_context_tools(self):
        tools = get_all_tool_definitions(active_skill_names={"draft_writer"})
        names = {tool.function.name for tool in tools}

        for expected in [
            "get_outline_structure",
            "list_events",
            "list_characters",
            "get_character_profile",
            "query_relationships",
            "list_foreshadows",
            "check_unresolved_foreshadows",
            "manageTodos",
            "search_tools",
        ]:
            self.assertIn(expected, names)

    async def test_core_skill_assets_do_not_reference_legacy_novelide_tools(self):
        legacy_markers = [
            "outline_get",
            "outline_manage",
            "processOutlineInput",
            "update_character_profile",
            'activate_skill("对话写作")',
            'activate_skill("打斗场景")',
            'activate_skill("情绪渲染")',
            'activate_skill("场景描写")',
            'activate_skill("正文扩写")',
            'activate_skill("文本润色")',
            'manageTodos(action: "complete", indices',
        ]
        checked_assets = {
            item["path"]: item
            for item in list_skill_assets()
            if item["path"] in {"core/draft_writer.md", "core/outline_architect.md"}
        }

        for path in checked_assets:
            text = (Path(__file__).resolve().parents[1] / "core" / "skills" / "assets" / path).read_text(encoding="utf-8")
            for marker in legacy_markers:
                with self.subTest(path=path, marker=marker):
                    self.assertNotIn(marker, text)

    async def test_outline_architect_unlocks_planning_tools(self):
        tools = get_all_tool_definitions(active_skill_names={"outline_architect"})
        names = {tool.function.name for tool in tools}

        for expected in [
            "get_outline_structure",
            "create_volume",
            "create_chapter",
            "create_event",
            "update_event",
            "list_events",
            "create_foreshadow",
            "check_unresolved_foreshadows",
        ]:
            self.assertIn(expected, names)

    async def test_manage_todos_persists_to_database_and_context(self):
        added = await execute_tool(
            ToolCall(id="todo_add", name="manageTodos", arguments={
                "action": "add",
                "text": "写完第一章后检查伏笔",
                "priority": "high",
            }),
            self.project_id,
        )
        self.assertEqual(added.status, ToolResultStatus.EXECUTED)
        self.assertEqual(added.result["todos"][0]["text"], "写完第一章后检查伏笔")

        listed = await execute_tool(
            ToolCall(id="todo_list", name="manageTodos", arguments={"action": "list"}),
            self.project_id,
        )
        self.assertEqual(listed.status, ToolResultStatus.EXECUTED)
        self.assertEqual(len(listed.result["todos"]), 1)

        prompt = await build_system_prompt(self.project_id, self.project_dir)
        self.assertIn("写完第一章后检查伏笔", prompt)

    async def test_execution_plan_persists_in_project_database(self):
        await persist_execution_plan(self.project_id, "s_plan", {"steps": [{"id": "a", "status": "pending"}]})

        project_db = await get_db(self.project_id)
        try:
            project_rows = await project_db.execute_fetchall(
                "SELECT project_id, session_id, plan FROM execution_plans WHERE session_id = ?",
                ("s_plan",),
            )
        finally:
            await project_db.close()

        shared_db = await get_db()
        try:
            shared_rows = await shared_db.execute_fetchall(
                "SELECT session_id FROM execution_plans WHERE session_id = ?",
                ("s_plan",),
            )
        finally:
            await shared_db.close()

        self.assertEqual(len(project_rows), 1)
        self.assertEqual(project_rows[0]["project_id"], self.project_id)
        self.assertEqual(shared_rows, [])

    async def test_conversation_knowledge_extracts_current_turn_write_tools(self):
        db = await get_db(self.project_id)
        now = int(time.time())
        await db.execute(
            "INSERT INTO chat_sessions (id, project_id, title, created_at, last_modified) VALUES ('s_extract', ?, '抽取会话', ?, ?)",
            (self.project_id, now, now),
        )
        await db.commit()
        await db.close()

        messages = [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_event",
                        "type": "function",
                        "function": {"name": "create_event", "arguments": "{\"name\":\"黑玉异动\"}"},
                    },
                    {
                        "id": "call_todo",
                        "type": "function",
                        "function": {"name": "manageTodos", "arguments": "{\"action\":\"add\",\"text\":\"补全黑玉伏笔\"}"},
                    },
                ],
            },
            {"role": "tool", "tool_call_id": "call_event", "content": "{\"id\":\"evt1\",\"name\":\"黑玉异动\",\"description\":\"第一章结尾黑玉发热\"}"},
            {"role": "tool", "tool_call_id": "call_todo", "content": "{\"todo\":{\"text\":\"补全黑玉伏笔\"},\"todos\":[]}"},
        ]

        extracted = await extract_conversation_knowledge(messages, self.project_id, "s_extract")
        summaries = [item["summary"] for item in extracted]

        self.assertTrue(any("create_event" in summary for summary in summaries))
        self.assertTrue(any("manageTodos" in summary for summary in summaries))

    async def test_blaze_base_url_is_normalized(self):
        self.assertEqual(
            normalize_api_base_url(" https://blazeai.boxu.dev/api/v1 "),
            "https://blazeai.boxu.dev/api/",
        )
        self.assertEqual(
            normalize_api_base_url("https://blazeai.boxu.dev/api/"),
            "https://blazeai.boxu.dev/api/",
        )
        self.assertEqual(provider_hint_for("https://blazeai.boxu.dev/api/"), "blazeapi")

    async def test_http_status_errors_are_user_friendly(self):
        import httpx
        request = httpx.Request("GET", "https://example.com")
        response = httpx.Response(429, request=request)
        error = httpx.HTTPStatusError("rate limit", request=request, response=response)
        self.assertIn("限流", friendly_api_error(error))

    async def test_openai_sdk_errors_are_user_friendly(self):
        import httpx
        from openai import APIConnectionError, APIStatusError, APITimeoutError, RateLimitError

        request = httpx.Request("POST", "https://example.com/chat/completions")
        cases = [
            (APIStatusError("unauthorized", response=httpx.Response(401, request=request), body=None), "API Key"),
            (APIStatusError("forbidden", response=httpx.Response(403, request=request), body=None), "无权限"),
            (APIStatusError("not found", response=httpx.Response(404, request=request), body=None), "模型"),
            (RateLimitError("rate limit", response=httpx.Response(429, request=request), body=None), "限流"),
            (APIStatusError("server", response=httpx.Response(503, request=request), body=None), "上游"),
            (APITimeoutError(request), "超时"),
            (APIConnectionError(request=request), "无法连接"),
        ]
        for error, expected in cases:
            with self.subTest(expected=expected):
                self.assertIn(expected, friendly_api_error(error))

    async def test_retry_with_backoff_raises_friendly_error_after_timeout_exhausted(self):
        import httpx
        from openai import APITimeoutError

        request = httpx.Request("POST", "https://example.com/chat/completions")
        attempts = 0

        async def always_timeout():
            nonlocal attempts
            attempts += 1
            raise APITimeoutError(request)

        with self.assertRaisesRegex(RuntimeError, "超时"):
            await _retry_with_backoff(always_timeout, max_retries=0)
        self.assertEqual(attempts, 1)
