import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import settings
from db import database
from db.database import get_db, init_db


class FakeProvider:
    async def chat(self, messages, temperature=0.7, **kwargs):
        if _is_intent_classification(messages):
            user_msg = _user_msg_from_messages(messages)
            intent = _detect_intent_from_msg(user_msg)
            return _intent_json(messages, intent)
        return "# 第一章\n\n这是测试章节。"


class FakeExtractProvider:
    async def chat(self, messages, temperature=0.7, **kwargs):
        return json.dumps({
            "candidates": [
                {
                    "candidate_type": "world_setting",
                    "payload": {
                        "name": "灵气潮汐",
                        "summary": "灵气会周期性涨落",
                        "description": "宗门附近灵气出现潮汐。",
                        "evidence": "宗门附近灵气出现潮汐。",
                        "confidence": 0.91,
                        "target_type": "knowledge_node",
                        "suggested_update": "写入世界观设定",
                    },
                }
            ]
        }, ensure_ascii=False)


class FakeReviewPolishProvider:
    async def chat(self, messages, temperature=0.7, **kwargs):
        if _is_intent_classification(messages):
            user_msg = _user_msg_from_messages(messages)
            return _intent_json(messages, _detect_intent_from_msg(user_msg))
        prompt = messages[-1]["content"]
        if "结构化 JSON" in prompt:
            return json.dumps({
                "summary": "节奏清楚，但结尾钩子可加强。",
                "issues": [
                    {"severity": "medium", "location": "结尾", "problem": "钩子不足", "suggestion": "增加黑玉异动"}
                ],
                "revision_focus": ["加强章末钩子"],
            }, ensure_ascii=False)
        return "# 第一章\n\n润色后的章节内容，黑玉再次发热。"


class FakeContinuityProvider:
    async def chat(self, messages, temperature=0.7, **kwargs):
        return json.dumps({
            "summary": "本章整体承接前文，但角色状态与伏笔推进需要校正。",
            "issues": [
                {
                    "issue_type": "character_state",
                    "severity": "high",
                    "location": "中段",
                    "evidence": "林玄突然熟练使用黑玉秘术",
                    "problem": "前文只确认林玄持有黑玉，尚未学会秘术",
                    "suggestion": "改为黑玉被动发热，避免能力跳跃",
                },
                {
                    "issue_type": "foreshadowing",
                    "severity": "medium",
                    "location": "结尾",
                    "evidence": "藏经楼线索没有推进",
                    "problem": "上一章埋下的藏经楼伏笔未处理",
                    "suggestion": "在章末加入藏经楼封条异动",
                },
                {
                    "issue_type": "emotional_continuity",
                    "severity": "low",
                    "location": "开头",
                    "evidence": "林玄上一章受挫，本章直接冷静布局",
                    "problem": "情绪恢复缺少过渡",
                    "suggestion": "补一段压住恐惧后继续调查的心理承接",
                },
                {
                    "issue_type": "chapter_goal_drift",
                    "severity": "medium",
                    "location": "后半段",
                    "evidence": "本章目标是追查黑玉，却转向矿脉支线",
                    "problem": "章节目标发生偏移",
                    "suggestion": "把矿脉线索改为服务黑玉追查",
                },
            ],
        }, ensure_ascii=False)


class CapturingJsonProvider:
    def __init__(self):
        self.calls = []

    async def chat(self, messages, temperature=0.7, **kwargs):
        if _is_intent_classification(messages):
            user_msg = _user_msg_from_messages(messages)
            return _intent_json(messages, _detect_intent_from_msg(user_msg))
        self.calls.append({
            "messages": messages,
            "temperature": temperature,
            "kwargs": kwargs,
        })
        prompt = messages[-1]["content"]
        if "连续性" in prompt:
            return json.dumps({"summary": "连续性良好", "issues": []}, ensure_ascii=False)
        return json.dumps({"summary": "审稿完成", "issues": [], "revision_focus": []}, ensure_ascii=False)


def _is_intent_classification(messages: list[dict]) -> bool:
    for m in messages:
        if m.get("role") == "system" and "意图分类器" in m.get("content", ""):
            return True
    return False


def _user_msg_from_messages(messages: list[dict]) -> str:
    for m in messages:
        if m.get("role") == "user":
            return m["content"]
    return ""


_INTENT_WORKFLOW_MAP = {
    "world_build": "project_init",
    "character_build": "character_build",
    "outline_build": "outline_build",
    "chapter_draft": "chapter_draft",
    "chapter_review": "chapter_review",
    "chapter_polish": "chapter_polish",
    "chapter_task": "chapter_task",
}


def _detect_intent_from_msg(user_msg: str) -> str:
    if "查一下" in user_msg or "查询" in user_msg:
        return "project_query"
    if "写" in user_msg and ("章" in user_msg or "战斗" in user_msg or "对" in user_msg or "正文" in user_msg or "初稿" in user_msg or "一章" in user_msg):
        return "chapter_draft"
    if "世界观" in user_msg or "核心设定" in user_msg:
        return "world_build"
    if "角色" in user_msg:
        return "character_build"
    if "大纲" in user_msg:
        return "outline_build"
    if "审稿" in user_msg:
        return "chapter_review"
    if "润色" in user_msg:
        return "chapter_polish"
    if "规划" in user_msg:
        return "creative_planning"
    return "project_dialogue"


def _intent_json(messages: list[dict], fallback: str = "project_dialogue") -> str:
    workflow = _INTENT_WORKFLOW_MAP.get(fallback)
    return json.dumps({
        "intent": fallback,
        "confidence": 0.85,
        "reasons": [f"mock: {fallback}"],
        "suggested_workflow": workflow,
    }, ensure_ascii=False)


class ProjectTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.old_projects_dir = settings.projects_dir
        self.old_api_key = settings.api_key
        settings.projects_dir = Path(self.tmp.name)
        settings.api_key = ""
        database._initialized_dbs.clear()
        self.project_id = "testproj"
        self.project_dir = settings.projects_dir / self.project_id
        (self.project_dir / ".novelwriter").mkdir(parents=True)
        await init_db(self.project_id)
        db = await get_db(self.project_id)
        now = int(time.time())
        await db.execute(
            "INSERT INTO projects (id, name, description, created_at, last_modified) VALUES (?, ?, '', ?, ?)",
            (self.project_id, "测试项目", now, now),
        )
        await db.commit()
        await db.close()

    async def asyncTearDown(self):
        settings.projects_dir = self.old_projects_dir
        settings.api_key = self.old_api_key
        database._initialized_dbs.clear()
        self.tmp.cleanup()
