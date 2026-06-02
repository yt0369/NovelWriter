import json
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from core.agent.intent import build_intent_preview, classify_agent_intent
from core.agent.engine import _sanitize_user_visible_content, run_agent
from core.agent.tool_runner import ToolRunner
from models.tools import ToolCall, ToolResult, ToolResultStatus
from support import ProjectTestCase


def skill_ids(preview):
    return [item["id"] for item in preview["suggested_skills"]]


class MockIntentProvider:
    """返回预设 JSON 的 mock provider，用于意图分类测试。"""

    def __init__(self, response_map: dict[str, dict]):
        self._map = response_map

    async def chat(self, messages, temperature=0.7, max_tokens=None):
        user_msg = messages[-1]["content"] if messages else ""
        for keyword, resp in self._map.items():
            if keyword in user_msg:
                return json.dumps(resp, ensure_ascii=False)
        return json.dumps({"intent": "project_dialogue", "confidence": 0.55, "reasons": ["mock fallback"], "suggested_workflow": None}, ensure_ascii=False)


class AgentIntentTests(unittest.IsolatedAsyncioTestCase):
    async def test_fallback_dialogue_uses_project_context_without_write(self):
        provider = MockIntentProvider({})
        preview = await build_intent_preview("今天状态有点差，陪我聊两句", provider)

        self.assertEqual(preview["intent"], "project_dialogue")
        self.assertTrue(preview["requires_context"])
        self.assertFalse(preview["will_write"])
        self.assertIsNone(preview["suggested_workflow"])

    async def test_chapter_draft_recommends_contextual_skills(self):
        provider = MockIntentProvider({
            "写第2章": {"intent": "chapter_draft", "confidence": 0.88, "reasons": ["要写章节正文"], "suggested_workflow": "chapter_draft"},
        })
        preview = await build_intent_preview(
            "帮我写第2章，包含战斗、对话和情绪爆发",
            provider,
            chapter_index=2,
            title="宗门夜战",
        )

        self.assertEqual(preview["intent"], "chapter_draft")
        self.assertTrue(preview["requires_context"])
        self.assertTrue(preview["will_write"])
        self.assertEqual(preview["suggested_workflow"], "chapter_draft")
        self.assertIn("draft_writer", skill_ids(preview))
        self.assertIn("combat_scenes", skill_ids(preview))
        self.assertIn("dialogue_writing", skill_ids(preview))
        self.assertIn("emotion_rendering", skill_ids(preview))
        self.assertTrue(preview["skill_activation_trace"][0]["trigger"].startswith("intent:"))

    async def test_review_and_polish_intents_use_review_skills(self):
        provider = MockIntentProvider({
            "审稿一下": {"intent": "chapter_review", "confidence": 0.86, "reasons": ["审稿"], "suggested_workflow": "chapter_review"},
            "润色这一章": {"intent": "chapter_polish", "confidence": 0.86, "reasons": ["润色"], "suggested_workflow": "chapter_polish"},
        })

        review = await classify_agent_intent("审稿一下当前章节，列出问题", provider)
        polish = await classify_agent_intent("根据最近审稿结果润色这一章，去掉 AI 味", provider)

        self.assertEqual(review["intent"], "chapter_review")
        self.assertEqual(review["suggested_workflow"], "chapter_review")
        self.assertIn("editor_review", skill_ids(review))

        self.assertEqual(polish["intent"], "chapter_polish")
        self.assertEqual(polish["suggested_workflow"], "chapter_polish")
        self.assertIn("text_polish", skill_ids(polish))

    async def test_skill_triggers_read_activation_hints_from_assets(self):
        provider = MockIntentProvider({
            "潜台词对白": {"intent": "chapter_draft", "confidence": 0.88, "reasons": ["写章节"], "suggested_workflow": "chapter_draft"},
        })
        preview = await build_intent_preview("这章要写两个人互相试探的潜台词对白", provider)

        self.assertEqual(preview["intent"], "chapter_draft")
        self.assertIn("dialogue_writing", skill_ids(preview))
        trace = next(item for item in preview["skill_activation_trace"] if item["id"] == "dialogue_writing")
        self.assertEqual(trace["source_type"], "keyword")
        self.assertIn("activation_hints", trace["trigger"])

    async def test_project_query_and_task_intents_are_non_writing_context_requests(self):
        provider = MockIntentProvider({
            "查一下主角": {"intent": "project_query", "confidence": 0.76, "reasons": ["查询"], "suggested_workflow": None},
            "必须处理": {"intent": "chapter_task", "confidence": 0.8, "reasons": ["任务处理"], "suggested_workflow": "chapter_task"},
        })

        query = await build_intent_preview("查一下主角现在的角色状态和未回收伏笔", provider)
        task = await build_intent_preview("下一章之前有哪些必须处理的章节任务？", provider)

        self.assertEqual(query["intent"], "project_query")
        self.assertTrue(query["requires_context"])
        self.assertFalse(query["will_write"])

        self.assertEqual(task["intent"], "chapter_task")
        self.assertEqual(task["suggested_workflow"], "chapter_task")
        self.assertTrue(task["requires_context"])
        self.assertFalse(task["will_write"])

    async def test_creative_asset_intents_are_routed_to_workflows(self):
        provider = MockIntentProvider({
            "规划小说": {"intent": "creative_planning", "confidence": 0.86, "reasons": ["规划"], "suggested_workflow": None},
            "构建世界观": {"intent": "world_build", "confidence": 0.86, "reasons": ["世界观"], "suggested_workflow": "project_init"},
            "设计主要角色": {"intent": "character_build", "confidence": 0.84, "reasons": ["角色设计"], "suggested_workflow": "character_build"},
            "生成前5章": {"intent": "outline_build", "confidence": 0.84, "reasons": ["大纲"], "suggested_workflow": "outline_build"},
        })

        planning = await build_intent_preview("请规划小说的创作，结合这篇小说的基本信息给我下一步方案", provider)
        world = await build_intent_preview("帮我构建世界观和核心设定", provider)
        character = await build_intent_preview("设计主要角色和人物关系张力", provider)
        outline = await build_intent_preview("生成前5章剧情大纲", provider)

        self.assertEqual(planning["intent"], "creative_planning")
        self.assertIsNone(planning["suggested_workflow"])
        self.assertTrue(planning["requires_context"])
        self.assertFalse(planning["will_write"])
        self.assertIn("project_init", skill_ids(planning))
        self.assertIn("world_builder", skill_ids(planning))
        self.assertIn("character_designer", skill_ids(planning))
        self.assertIn("outline_architect", skill_ids(planning))
        self.assertIn("pleasure_rhythm_manager", skill_ids(planning))

        self.assertEqual(world["intent"], "world_build")
        self.assertEqual(world["suggested_workflow"], "project_init")
        self.assertIn("world_builder", skill_ids(world))

        self.assertEqual(character["intent"], "character_build")
        self.assertEqual(character["suggested_workflow"], "character_build")
        self.assertIn("character_designer", skill_ids(character))
        self.assertIn("character_status", skill_ids(character))

        self.assertEqual(outline["intent"], "outline_build")
        self.assertEqual(outline["suggested_workflow"], "outline_build")
        self.assertIn("outline_architect", skill_ids(outline))
        self.assertIn("pleasure_rhythm_manager", skill_ids(outline))

    async def test_llm_failure_falls_back_to_project_dialogue(self):
        class FailingProvider:
            async def chat(self, messages, temperature=0.7, max_tokens=None):
                raise RuntimeError("API down")

        preview = await build_intent_preview("写第一章", FailingProvider())
        self.assertEqual(preview["intent"], "project_dialogue")
        self.assertFalse(preview["will_write"])


class FakeToollessProvider:
    async def chat(self, messages, temperature=0.7, max_tokens=None):
        return json.dumps({"intent": "chapter_draft", "confidence": 0.88, "reasons": ["mock: 写章节"], "suggested_workflow": "chapter_draft"}, ensure_ascii=False)

    async def chat_with_tools(self, messages, tools=None, temperature=0.7, max_tokens=None):
        return {"content": "收到，我先和你聊聊。", "tool_calls": None}


class FakePlanningProvider(FakeToollessProvider):
    async def chat(self, messages, temperature=0.7, max_tokens=None):
        return json.dumps({"intent": "creative_planning", "confidence": 0.88, "reasons": ["mock: 规划"], "suggested_workflow": None}, ensure_ascii=False)


class SkillRefreshProvider:
    def __init__(self):
        self.tool_names_by_call: list[list[str]] = []

    async def chat(self, messages, temperature=0.7, max_tokens=None):
        return json.dumps({"intent": "project_dialogue", "confidence": 0.8, "reasons": ["mock"], "suggested_workflow": None}, ensure_ascii=False)

    async def chat_with_tools(self, messages, tools=None, temperature=0.7, max_tokens=None):
        names = [tool["function"]["name"] for tool in (tools or [])]
        self.tool_names_by_call.append(names)
        if len(self.tool_names_by_call) == 1:
            return {
                "content": "",
                "tool_calls": [{
                    "id": "call_activate_character",
                    "name": "activate_skill",
                    "arguments": {"skill_name": "character_designer"},
                }],
            }
        return {"content": "技能已加载。", "tool_calls": None}


class MissingFileQuestionnaireProvider:
    def __init__(self):
        self.messages_by_call: list[list[dict]] = []

    async def chat(self, messages, temperature=0.7, max_tokens=None):
        return json.dumps({"intent": "chapter_draft", "confidence": 0.8, "reasons": ["mock"], "suggested_workflow": "chapter_draft"}, ensure_ascii=False)

    async def chat_with_tools(self, messages, tools=None, temperature=0.7, max_tokens=None):
        self.messages_by_call.append(messages)
        if len(self.messages_by_call) == 1:
            return {
                "content": "",
                "tool_calls": [{
                    "id": "call_missing_outline",
                    "name": "read_file",
                    "arguments": {"path": "章节大纲/第一章.md"},
                }],
            }
        last_tool_content = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "tool"), "")
        if "[主动问卷提示]" in last_tool_content:
            return {
                "content": "",
                "tool_calls": [{
                    "id": "call_questions",
                    "name": "ask_questions",
                    "arguments": {
                        "questions": [{
                            "id": "chapter_goal",
                            "question": "第一章的核心冲突是什么？",
                            "options": [{"label": "追查异常"}, {"label": "建立困境"}],
                        }],
                    },
                }],
            }
        return {"content": "无法继续。", "tool_calls": None}


class ChapterDraftLoopProvider:
    def __init__(self):
        self.tool_names_by_call: list[list[str]] = []
        self.messages_by_call: list[list[dict]] = []

    async def chat(self, messages, temperature=0.7, max_tokens=None):
        return json.dumps({
            "intent": "chapter_draft",
            "confidence": 0.9,
            "reasons": ["mock: 写章节"],
            "suggested_workflow": "chapter_draft",
        }, ensure_ascii=False)

    async def chat_with_tools(self, messages, tools=None, temperature=0.7, max_tokens=None):
        self.messages_by_call.append(messages)
        names = [tool["function"]["name"] for tool in (tools or [])]
        self.tool_names_by_call.append(names)
        call_no = len(self.tool_names_by_call)

        if call_no == 1:
            return {
                "content": "",
                "tool_calls": [{
                    "id": "call_activate_draft",
                    "name": "activate_skill",
                    "arguments": {"skill_name": "draft_writer"},
                }],
            }

        if call_no == 2:
            return {
                "content": "",
                "tool_calls": [
                    {"id": "call_outline", "name": "get_outline_structure", "arguments": {}},
                    {"id": "call_events", "name": "list_events", "arguments": {}},
                    {"id": "call_characters", "name": "list_characters", "arguments": {}},
                    {"id": "call_foreshadows", "name": "list_foreshadows", "arguments": {}},
                    {"id": "call_prev", "name": "read_file", "arguments": {"path": "正文/上一章.md"}},
                ],
            }

        if call_no == 3:
            return {
                "content": "",
                "tool_calls": [{
                    "id": "call_write_chapter",
                    "name": "write_file",
                    "arguments": {
                        "path": "正文/第一章.md",
                        "content": "# 第一章\n\n林玄在黑玉发热时推开宗门旧门。",
                    },
                }],
            }

        if call_no == 4:
            return {
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_event",
                        "name": "create_event",
                        "arguments": {
                            "name": "黑玉发热",
                            "description": "第一章草稿中黑玉第一次主动发热。",
                            "status": "planned",
                        },
                    },
                    {
                        "id": "call_todo",
                        "name": "manageTodos",
                        "arguments": {
                            "action": "add",
                            "text": "审批后补角色状态",
                            "priority": "medium",
                        },
                    },
                ],
            }

        return {
            "content": "",
            "tool_calls": [{
                "id": "call_final",
                "name": "final_answer",
                "arguments": {"message": "第一章草稿已进入审批，并同步了事件和待办。"},
            }],
        }


class LeakyToolContentProvider:
    async def chat(self, messages, temperature=0.7, max_tokens=None):
        return json.dumps({
            "intent": "outline_planning",
            "confidence": 0.9,
            "reasons": ["mock: 大纲规划"],
            "suggested_workflow": None,
        }, ensure_ascii=False)

    async def chat_with_tools(self, messages, tools=None, temperature=0.7, max_tokens=None):
        return {
            "content": '好，10卷已创建。{"id":"v1","name":"卷一：穿越背债"}',
            "tool_calls": [{
                "id": "call_final",
                "name": "final_answer",
                "arguments": {"message": "大纲结构已创建，待审批内容请在审批面板查看。"},
            }],
        }


class AgentEngineIntentTests(ProjectTestCase):
    async def test_run_agent_emits_intent_event_before_answer(self):
        # 意图识别默认禁用，启用后测试
        from config import settings
        old_value = settings.enable_intent_detection
        settings.enable_intent_detection = True
        try:
            events = []
            async for event in run_agent(
                [{"role": "user", "content": "帮我写第2章，有战斗和对话"}],
                FakeToollessProvider(),
                self.project_id,
                self.project_dir,
            ):
                events.append(event)
                break

            self.assertEqual(events[0]["type"], "intent")
            self.assertEqual(events[0]["intent"], "chapter_draft")
            skill_ids = [item["id"] for item in events[0]["active_skills"]]
            self.assertIn("draft_writer", skill_ids)
            self.assertIn("combat_scenes", skill_ids)
            self.assertIn("dialogue_writing", skill_ids)
        finally:
            settings.enable_intent_detection = old_value

    async def test_run_agent_refreshes_tools_after_skill_activation_in_same_turn(self):
        from core.skills.definitions import register_all_skills
        from core.skills.registry import deactivate_skill

        register_all_skills()
        deactivate_skill("character_designer")
        provider = SkillRefreshProvider()

        events = []
        async for event in run_agent(
            [{"role": "user", "content": "请准备专门的创作工具"}],
            provider,
            self.project_id,
            self.project_dir,
        ):
            events.append(event)
            if event["type"] == "done":
                break

        self.assertGreaterEqual(len(provider.tool_names_by_call), 2)
        self.assertNotIn("create_character", provider.tool_names_by_call[0])
        self.assertIn("create_character", provider.tool_names_by_call[1])
        self.assertTrue(any(e["type"] == "history" for e in events))

    async def test_run_agent_emits_execution_plan_when_enabled(self):
        from config import settings

        old_intent = settings.enable_intent_detection
        old_plan = settings.enable_execution_plan
        settings.enable_intent_detection = False
        settings.enable_execution_plan = True
        try:
            events = []
            async for event in run_agent(
                [{"role": "user", "content": "请规划小说下一步"}],
                FakePlanningProvider(),
                self.project_id,
                self.project_dir,
                session_id="s_plan",
            ):
                events.append(event)
                if event["type"] == "execution_plan":
                    break

            self.assertEqual(events[0]["type"], "execution_plan")
            self.assertEqual(events[0]["session_id"], "s_plan")
            self.assertIn("context_sources", events[0]["plan"])
        finally:
            settings.enable_intent_detection = old_intent
            settings.enable_execution_plan = old_plan

    async def test_missing_key_story_file_guides_model_to_questionnaire(self):
        from config import settings
        from core.tools.questionnaire_tools import clear_questionnaire

        old_value = settings.enable_proactive_questionnaire
        settings.enable_proactive_questionnaire = True
        provider = MissingFileQuestionnaireProvider()
        session_id = "s_questionnaire"
        try:
            events = []
            async for event in run_agent(
                [{"role": "user", "content": "帮我写第一章"}],
                provider,
                self.project_id,
                self.project_dir,
                session_id=session_id,
            ):
                events.append(event)
                if event["type"] == "questionnaire":
                    break

            tool_history = [
                e["message"]["content"]
                for e in events
                if e["type"] == "history" and e.get("message", {}).get("role") == "tool"
            ]
            self.assertTrue(any("[主动问卷提示]" in content for content in tool_history))
            self.assertEqual(events[-1]["type"], "questionnaire")
            self.assertEqual(events[-1]["questionnaire"]["questions"][0]["id"], "chapter_goal")
        finally:
            settings.enable_proactive_questionnaire = old_value
            await clear_questionnaire(self.project_id, session_id=session_id)

    async def test_chapter_draft_loop_reaches_approval_sync_todo_and_summary(self):
        (self.project_dir / "正文").mkdir(parents=True, exist_ok=True)
        (self.project_dir / "正文" / "上一章.md").write_text(
            "# 上一章\n\n林玄得到黑玉，但尚不知其用途。",
            encoding="utf-8",
        )
        provider = ChapterDraftLoopProvider()

        events = []
        async for event in run_agent(
            [{"role": "user", "content": "帮我写第1章，承接上一章黑玉伏笔"}],
            provider,
            self.project_id,
            self.project_dir,
        ):
            events.append(event)
            if event["type"] == "done":
                break

        self.assertGreaterEqual(len(provider.tool_names_by_call), 4)
        second_call_tools = provider.tool_names_by_call[1]
        for expected in [
            "get_outline_structure",
            "list_events",
            "list_characters",
            "list_foreshadows",
            "read_file",
            "write_file",
            "manageTodos",
        ]:
            self.assertIn(expected, second_call_tools)

        approvals = [e for e in events if e["type"] == "approval_required"]
        self.assertEqual(len(approvals), 1)
        self.assertEqual(approvals[0]["pending_change"]["file_path"], "正文/第一章.md")
        self.assertIn("林玄在黑玉发热时", approvals[0]["pending_change"]["new_content"])

        tool_history = [
            e["message"]["content"]
            for e in events
            if e["type"] == "history" and e.get("message", {}).get("role") == "tool"
        ]
        self.assertTrue(any("待审批内容（Shadow Read）" in content for content in tool_history))
        self.assertTrue(any("第一章" in content for content in tool_history))

        todo_events = [e for e in events if e["type"] == "todo"]
        self.assertEqual(len(todo_events), 1)
        self.assertEqual(todo_events[0]["items"][0]["text"], "审批后补角色状态")
        self.assertEqual(events[-1]["content"], "第一章草稿已进入审批，并同步了事件和待办。")

    async def test_tool_call_content_is_not_shown_as_chat_delta(self):
        events = []
        async for event in run_agent(
            [{"role": "user", "content": "创建全书大纲结构"}],
            LeakyToolContentProvider(),
            self.project_id,
            self.project_dir,
        ):
            events.append(event)
            if event["type"] == "done":
                break

        visible_text = "\n".join(e.get("content", "") for e in events if e["type"] in {"delta", "done"})
        self.assertIn("大纲结构已创建", visible_text)
        self.assertNotIn("10卷已创建", visible_text)
        self.assertNotIn('"id":"v1"', visible_text)

    async def test_shadow_read_artifacts_are_removed_from_visible_content(self):
        leaked = '''✅ 文件 "章节大纲/全书大纲.md" 的变更已排队等待用户审批。
操作: 写入文件: 章节大纲/全书大纲.md

## 待审批内容（Shadow Read）
以下是你要写入的完整内容，用户审批后会写入文件：

```markdown
# 全书大纲
```

请继续执行其他任务，假设此变更会被批准。'''

        self.assertEqual(_sanitize_user_visible_content(leaked), "")

    async def test_tool_runner_preserves_write_barriers_between_read_batches(self):
        calls: list[str] = []

        async def fake_execute_tool(tool_call, project_id, session_id=""):
            calls.append(tool_call.name)
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=tool_call.name, result={"ok": True})

        runner = ToolRunner(self.project_id)
        with patch("core.agent.tool_runner.execute_tool", side_effect=fake_execute_tool):
            results = await runner.run_concurrent([
                ToolCall(id="r1", name="read_file", arguments={"path": "a.md"}),
                ToolCall(id="w1", name="write_file", arguments={"path": "b.md", "content": "B"}),
                ToolCall(id="r2", name="grep", arguments={"query": "B"}),
                ToolCall(id="w2", name="manageTodos", arguments={"action": "add", "text": "收尾"}),
            ])

        self.assertEqual([r.tool_name for r in results], ["read_file", "write_file", "grep", "manageTodos"])
        self.assertEqual(calls, ["read_file", "write_file", "grep", "manageTodos"])


if __name__ == "__main__":
    unittest.main()
