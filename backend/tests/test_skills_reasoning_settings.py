import asyncio
import time
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ai.compat import friendly_api_error, normalize_api_base_url, provider_hint_for
from ai.openai_provider import _normalize_system_messages, _retry_with_backoff
from api import settings as settings_api
from api.agent import (
    approve_change,
    get_messages,
    get_active_questionnaire as api_get_active_questionnaire,
    _load_agent_history,
    _load_chat_messages,
    _save_chat_message,
    _truncate_chat_messages,
    _update_chat_message_content,
)
from api.plans import persist_execution_plan
from api.settings import FullAISettings, OpenAIBackend, get_ai_settings, update_ai_settings
from api.skills import get_skill_assets, list_skills
from config import settings
from core.agent.reasoning import ThinkStreamSplitter, split_model_output
from core.agent.context import build_system_prompt
from core.memory.stack import extract_conversation_knowledge
from core.tools import get_all_tool_definitions, execute_tool
from core.tools.evolution_tools import execute_evolution_tool
from core.pending_changes import create_pending_change, get_pending_change, update_pending_change_edit_status
from core.pending_changes import approve_pending_change
from models.tools import ToolCall, ToolResultStatus
from core.presets.definitions import GENRE_PRESETS
from core.skills.assets import (
    CORE_QUALITY_SKILL_IDS,
    list_skill_assets,
    validate_core_skill_assets,
)
from core.skills.definitions import register_all_skills
from core.skills.project_state import get_project_active_skill_names
from core.skills.registry import activate_skill, clear_active_skills, get_active_skill_names
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

    async def test_active_skills_are_isolated_by_project_scope(self):
        register_all_skills()

        activate_skill("draft_writer", scope="project_a")

        self.assertIn("draft_writer", get_active_skill_names(scope="project_a"))
        self.assertNotIn("draft_writer", get_active_skill_names(scope="project_b"))
        self.assertNotIn("draft_writer", get_active_skill_names())

    async def test_project_skill_settings_restore_project_active_skills(self):
        register_all_skills()
        db = await get_db(self.project_id)
        now = int(time.time())
        await db.execute(
            """INSERT INTO project_skill_settings (id, project_id, skill_id, enabled, source, created_at, updated_at)
               VALUES ('manual-draft-writer', ?, 'draft_writer', 1, 'manual', ?, ?)""",
            (self.project_id, now, now),
        )
        await db.commit()
        await db.close()

        clear_active_skills(scope=self.project_id)
        self.assertNotIn("draft_writer", get_active_skill_names(scope=self.project_id))

        active_names = await get_project_active_skill_names(self.project_id)
        self.assertIn("draft_writer", active_names)
        self.assertIn("draft_writer", get_active_skill_names(scope=self.project_id))

        skills = await list_skills(project_id=self.project_id)
        draft_writer = next(s for s in skills if s["name"] == "draft_writer")
        self.assertTrue(draft_writer["active"])

    async def test_ai_settings_masks_backend_keys_and_applies_active_backend_runtime_params(self):
        old_config_file = settings_api.CONFIG_FILE
        old_active_backend_id = settings.active_backend_id
        old_api_key = settings.api_key
        old_base_url = settings.api_base_url
        old_model = settings.model
        old_max_output_tokens = settings.max_output_tokens
        old_context_token_limit = settings.context_token_limit
        old_temperature = settings.temperature
        old_top_p = settings.top_p
        old_top_k = settings.top_k
        old_thinking_enabled = settings.thinking_enabled
        old_thinking_budget_tokens = settings.thinking_budget_tokens

        settings_api.CONFIG_FILE = self.project_dir / ".novelwriter" / "test-config.json"
        try:
            settings_api.save_backends([
                OpenAIBackend(
                    id="skyclaw",
                    name="SkyClaw",
                    base_url="https://api.apifree.ai/v1",
                    api_key="secret-key",
                    model_name="skywork-ai/skyclaw-v1",
                    max_output_tokens=65536,
                    context_token_limit=131072,
                    thinking_enabled=True,
                    thinking_budget_tokens=20000,
                    temperature=0.0,
                    top_p=0.5,
                    top_k=7,
                )
            ])
            settings.active_backend_id = "skyclaw"
            settings.api_key = "secret-key"

            loaded = await get_ai_settings()
            self.assertEqual(loaded.backends[0].api_key, "***")

            await update_ai_settings(FullAISettings(**loaded.model_dump()))

            self.assertEqual(settings.api_key, "secret-key")
            self.assertEqual(settings.model, "skywork-ai/skyclaw-v1")
            self.assertEqual(settings.max_output_tokens, 65536)
            self.assertEqual(settings.context_token_limit, 131072)
            self.assertEqual(settings.temperature, 0.0)
            self.assertEqual(settings.top_p, 0.5)
            self.assertEqual(settings.top_k, 7)
            self.assertTrue(settings.thinking_enabled)
            self.assertEqual(settings.thinking_budget_tokens, 20000)
            self.assertEqual(settings_api.load_backends()[0].api_key, "secret-key")
        finally:
            settings_api.CONFIG_FILE = old_config_file
            settings.active_backend_id = old_active_backend_id
            settings.api_key = old_api_key
            settings.api_base_url = old_base_url
            settings.model = old_model
            settings.max_output_tokens = old_max_output_tokens
            settings.context_token_limit = old_context_token_limit
            settings.temperature = old_temperature
            settings.top_p = old_top_p
            settings.top_k = old_top_k
            settings.thinking_enabled = old_thinking_enabled
            settings.thinking_budget_tokens = old_thinking_budget_tokens

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

    async def test_client_messages_hide_internal_agent_tool_history_after_refresh(self):
        db = await get_db(self.project_id)
        now = int(time.time())
        await db.execute(
            "INSERT INTO chat_sessions (id, project_id, title, created_at, last_modified) VALUES ('s_visible', ?, '可见会话', ?, ?)",
            (self.project_id, now, now),
        )
        await db.commit()
        await db.close()

        leaked_shadow_read = '''✅ 文件 "章节大纲/全书大纲.md" 的变更已排队等待用户审批。
操作: 写入文件: 章节大纲/全书大纲.md

## 待审批内容（Shadow Read）
以下是你要写入的完整内容，用户审批后会写入文件：

```markdown
# 全书大纲
```

请继续执行其他任务，假设此变更会被批准。'''

        await _save_chat_message(self.project_id, "s_visible", "user", "生成全书大纲")
        await _save_chat_message(
            self.project_id,
            "s_visible",
            "assistant",
            leaked_shadow_read,
            raw_parts={
                "role": "assistant",
                "content": leaked_shadow_read,
                "tool_calls": [{
                    "id": "call_write",
                    "type": "function",
                    "function": {"name": "write_file", "arguments": "{}"},
                }],
            },
            metadata={"source": "agent_history"},
        )
        await _save_chat_message(
            self.project_id,
            "s_visible",
            "tool",
            leaked_shadow_read,
            raw_parts={"role": "tool", "tool_call_id": "call_write", "content": leaked_shadow_read},
            metadata={"source": "agent_history"},
        )
        await _save_chat_message(self.project_id, "s_visible", "model", "大纲已生成，待审批内容请在审批面板查看。")

        client_messages = await get_messages(self.project_id, "s_visible")
        self.assertEqual([m["role"] for m in client_messages], ["user", "model"])
        visible_text = "\n".join(m["content"] for m in client_messages)
        self.assertIn("大纲已生成", visible_text)
        self.assertNotIn("Shadow Read", visible_text)
        self.assertNotIn("操作: 写入文件", visible_text)

        history = await _load_agent_history(self.project_id, "s_visible")
        self.assertTrue(any(m.get("role") == "tool" for m in history))

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

    async def test_chat_message_edit_and_branch_truncate_keep_agent_history_clean(self):
        db = await get_db(self.project_id)
        now = int(time.time())
        await db.execute(
            "INSERT INTO chat_sessions (id, project_id, title, created_at, last_modified) VALUES ('s_branch', ?, '分支会话', ?, ?)",
            (self.project_id, now, now),
        )
        await db.commit()
        await db.close()

        await _save_chat_message(self.project_id, "s_branch", "user", "旧问题")
        messages = await _load_chat_messages(self.project_id, "s_branch")
        user_id = messages[0]["id"]
        await _save_chat_message(
            self.project_id,
            "s_branch",
            "assistant",
            "",
            raw_parts={
                "role": "assistant",
                "content": "",
                "tool_calls": [{
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "read_file", "arguments": "{}"},
                }],
            },
        )
        await _save_chat_message(self.project_id, "s_branch", "tool", "{}", raw_parts={"role": "tool", "tool_call_id": "call_1", "content": "{}"})
        await _save_chat_message(self.project_id, "s_branch", "model", "旧回答")

        updated = await _update_chat_message_content(self.project_id, "s_branch", user_id, "新问题")
        self.assertEqual(updated["content"], "新问题")
        truncated = await _truncate_chat_messages(self.project_id, "s_branch", user_id, inclusive=False)
        self.assertEqual(truncated["deleted"], 3)

        history = await _load_agent_history(self.project_id, "s_branch")
        self.assertEqual(history, [{"role": "user", "content": "新问题"}])

    async def test_provider_normalizes_system_messages_before_api_call(self):
        messages = [
            {"role": "system", "content": "主系统提示"},
            {"role": "user", "content": "第一问"},
            {"role": "system", "content": "历史摘要"},
            {"role": "assistant", "content": "上一轮回复"},
            {"role": "system", "content": ""},
        ]

        normalized = _normalize_system_messages(messages)

        self.assertEqual([m["role"] for m in normalized], ["system", "user", "assistant"])
        self.assertEqual(normalized[0]["content"], "主系统提示\n\n历史摘要")
        self.assertNotIn("system", [m["role"] for m in normalized[1:]])

    async def test_active_questionnaire_can_be_restored_after_page_refresh(self):
        from core.tools import questionnaire_tools

        session_id = "s_refresh"
        try:
            result = await execute_tool(
                ToolCall(id="ask", name="ask_questions", arguments={
                    "questions": [{
                        "id": "chapter_goal",
                        "question": "第一章的核心冲突是什么？",
                        "options": [{"label": "追查异常"}, {"label": "建立困境"}],
                    }],
                }),
                self.project_id,
                session_id=session_id,
            )
            self.assertEqual(result.status, ToolResultStatus.EXECUTED)

            questionnaire_tools._active_questionnaires.clear()
            questionnaire = await api_get_active_questionnaire(self.project_id, session_id=session_id)
            self.assertEqual(questionnaire["status"], "active")
            self.assertEqual(questionnaire["session_id"], session_id)
            self.assertEqual(questionnaire["questions"][0]["id"], "chapter_goal")

            answered = await questionnaire_tools.answer_questionnaire(
                self.project_id,
                {"chapter_goal": "追查异常"},
                session_id=session_id,
            )
            self.assertEqual(answered["status"], "completed")
            self.assertEqual(answered["answers"]["chapter_goal"], "追查异常")
            self.assertIsNone(await api_get_active_questionnaire(self.project_id, session_id=session_id))
        finally:
            await questionnaire_tools.clear_questionnaire(self.project_id, session_id=session_id)

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

    async def test_system_prompt_includes_global_soul_and_project_soul_override(self):
        shared_db = await get_db()
        now = int(time.time())
        await shared_db.execute(
            "INSERT OR REPLACE INTO global_settings (key, value, updated_at) VALUES ('soul_content', ?, ?)",
            ("全局 Soul：回答要克制、具体、先确认事实。", now),
        )
        await shared_db.commit()
        await shared_db.close()

        soul_path = self.project_dir / "规范" / "项目Soul.md"
        soul_path.parent.mkdir(parents=True, exist_ok=True)
        soul_path.write_text("项目 Soul：本书保持冷峻、低魔、禁止现代口吻。", encoding="utf-8")

        prompt = await build_system_prompt(self.project_id, self.project_dir)
        self.assertIn("全局 Soul：回答要克制、具体、先确认事实。", prompt)
        self.assertIn("## 项目 Soul 覆盖", prompt)
        self.assertIn("项目 Soul：本书保持冷峻、低魔、禁止现代口吻。", prompt)
        self.assertIn("当前项目优先", prompt)

    async def test_file_tools_support_line_range_shadow_read_and_patch_edit_metadata(self):
        chapter_path = self.project_dir / "正文" / "第一章.md"
        chapter_path.parent.mkdir(parents=True, exist_ok=True)
        chapter_path.write_text("第一行\n第二行 黑玉\n第三行 黑玉\n第四行", encoding="utf-8")

        ranged = await execute_tool(
            ToolCall(id="read_range", name="read_file", arguments={
                "path": "正文/第一章.md",
                "start_line": 2,
                "end_line": 3,
                "include_pending": False,
            }),
            self.project_id,
        )
        self.assertEqual(ranged.status, ToolResultStatus.EXECUTED)
        self.assertEqual(ranged.result["content"], "第二行 黑玉\n第三行 黑玉")
        self.assertEqual(ranged.result["returned_start_line"], 2)
        self.assertEqual(ranged.result["returned_end_line"], 3)

        patched = await execute_tool(
            ToolCall(id="patch_multi", name="patch_file", arguments={
                "path": "正文/第一章.md",
                "edits": [
                    {"id": "e1", "old_text": "第二行 黑玉", "new_text": "第二行 青玉"},
                    {"id": "e2", "old_text": "第三行 黑玉", "new_text": "第三行 赤玉"},
                ],
            }),
            self.project_id,
        )
        self.assertEqual(patched.status, ToolResultStatus.APPROVAL_REQUIRED)
        self.assertIsNotNone(patched.pending_change)
        self.assertEqual(len(patched.pending_change.metadata["edits"]), 2)
        self.assertEqual(patched.pending_change.metadata["patch_report"][0]["match_count"], 1)

        shadow = await execute_tool(
            ToolCall(id="read_shadow", name="read_file", arguments={"path": "正文/第一章.md"}),
            self.project_id,
        )
        self.assertEqual(shadow.status, ToolResultStatus.EXECUTED)
        self.assertEqual(shadow.result["source"], "pending_shadow")
        self.assertIn("第二行 青玉", shadow.result["content"])

        updated = await update_pending_change_edit_status(
            self.project_id,
            patched.pending_change.id,
            "e2",
            "rejected",
        )
        self.assertIn("第二行 青玉", updated.new_content)
        self.assertIn("第三行 黑玉", updated.new_content)
        saved = await get_pending_change(self.project_id, patched.pending_change.id)
        self.assertEqual(saved["metadata"]["edits"][1]["status"], "rejected")

        failed = await execute_tool(
            ToolCall(id="patch_fail", name="patch_file", arguments={
                "path": "正文/第一章.md",
                "old_text": "不存在的文本",
                "new_text": "不会写入",
            }),
            self.project_id,
        )
        self.assertEqual(failed.status, ToolResultStatus.ERROR)
        self.assertIn("patch_report", failed.result)
        self.assertIn("先 read_file", failed.result["failures"][0]["suggestion"])

    async def test_pending_change_approval_uses_shared_core_for_delete_and_rename(self):
        docs_dir = self.project_dir / "资料"
        docs_dir.mkdir(parents=True, exist_ok=True)

        delete_path = docs_dir / "待删.md"
        delete_path.write_text("删除前内容", encoding="utf-8")
        delete_result = await execute_tool(
            ToolCall(id="delete", name="delete_file", arguments={"path": "资料/待删.md"}),
            self.project_id,
        )
        self.assertEqual(delete_result.status, ToolResultStatus.APPROVAL_REQUIRED)

        delete_approval = await approve_pending_change(self.project_id, delete_result.pending_change.id, source="test")
        self.assertEqual(delete_approval["status"], "approved")
        self.assertEqual(delete_approval["operation"], "delete")
        self.assertFalse(delete_path.exists())

        rename_path = docs_dir / "旧名.md"
        rename_path.write_text("重命名前内容", encoding="utf-8")
        rename_result = await execute_tool(
            ToolCall(id="rename", name="rename_file", arguments={"old_path": "资料/旧名.md", "new_name": "新名.md"}),
            self.project_id,
        )
        self.assertEqual(rename_result.status, ToolResultStatus.APPROVAL_REQUIRED)

        rename_approval = await approve_change(self.project_id, rename_result.pending_change.id)
        self.assertEqual(rename_approval["status"], "approved")
        self.assertEqual(rename_approval["operation"], "rename")
        self.assertEqual(rename_approval["old_file_path"], "资料/旧名.md")
        self.assertEqual(rename_approval["file_path"], "资料/新名.md")
        self.assertFalse(rename_path.exists())
        self.assertEqual((docs_dir / "新名.md").read_text(encoding="utf-8"), "重命名前内容")

        db = await get_db(self.project_id)
        try:
            versions = await db.execute_fetchall(
                "SELECT file_path, content, source FROM file_versions WHERE file_path IN (?, ?) ORDER BY file_path",
                ("资料/待删.md", "资料/旧名.md"),
            )
        finally:
            await db.close()
        self.assertEqual(len(versions), 2)
        self.assertEqual({row["file_path"] for row in versions}, {"资料/待删.md", "资料/旧名.md"})

        outline_result = await execute_tool(
            ToolCall(id="outline", name="create_outline_section", arguments={
                "title": "全书大纲",
                "content": "# 全书大纲\n\n核心结构。",
            }),
            self.project_id,
        )
        self.assertEqual(outline_result.status, ToolResultStatus.APPROVAL_REQUIRED)
        saved_outline_change = await get_pending_change(self.project_id, outline_result.pending_change.id)
        self.assertIsNotNone(saved_outline_change)
        outline_approval = await approve_change(self.project_id, outline_result.pending_change.id)
        self.assertEqual(outline_approval["status"], "approved")
        self.assertEqual((self.project_dir / "章节大纲" / "全书大纲.md").read_text(encoding="utf-8"), "# 全书大纲\n\n核心结构。")

    async def test_chapter_approval_does_not_wait_for_post_commit_extraction(self):
        from core import pending_changes as pending_changes_module

        entered = asyncio.Event()
        release = asyncio.Event()

        async def blocked_post_commit(project_id: str, file_path: str, content: str):
            entered.set()
            await release.wait()

        old_post_commit = pending_changes_module.create_post_commit_records
        pending_changes_module.create_post_commit_records = blocked_post_commit
        try:
            pending = await create_pending_change(
                self.project_id,
                "write_file",
                "正文/第一章.md",
                "",
                "# 第一章\n\n审批内容。",
                "写入正文",
                source="test",
            )

            approval = await asyncio.wait_for(
                approve_pending_change(self.project_id, pending.id, source="test"),
                timeout=0.5,
            )

            self.assertEqual(approval["status"], "approved")
            self.assertEqual((self.project_dir / "正文" / "第一章.md").read_text(encoding="utf-8"), "# 第一章\n\n审批内容。")
            await asyncio.wait_for(entered.wait(), timeout=0.5)
        finally:
            release.set()
            await asyncio.sleep(0)
            pending_changes_module.create_post_commit_records = old_post_commit

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
