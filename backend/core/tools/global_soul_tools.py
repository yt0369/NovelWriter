"""
全局 Soul 管理工具：读取或最小修改跨项目共享的全局 Soul。
数据存储在共享数据库 global_settings 表中。
"""
import json
import time

from models.tools import ToolDefinition, ToolFunction, ToolCall, ToolResult, ToolResultStatus
from db.database import get_db
from core.skills.definitions.core_protocol import DEFAULT_SOUL


# 使用 core_protocol 中的 DEFAULT_SOUL 作为默认内容
DEFAULT_GLOBAL_SOUL = DEFAULT_SOUL

SOUL_DB_KEY = "soul_content"


def get_global_soul_tool_definitions() -> list[ToolDefinition]:
    return [
        ToolDefinition(function=ToolFunction(
            name="manage_global_soul",
            description="""【全局 Soul 管理】读取或最小修改跨项目共享的全局 Soul。

## 使用边界
- 只保存跨项目长期有效的协作偏好、沟通习惯、稳定审美和高重要度纠正。
- 禁止写入世界观、角色口吻、专有名词、剧情事实、伏笔、章节状态和一次性任务偏好。
- patch 前必须先 read 当前全局 Soul。
- patch 必须是最小替换：用 exact 查找旧文本，用 replacement 替换；不要重写整份 Soul。
- 用户没有明确要求固化时，优先用 manage_memory 记录，不要擅自更新全局 Soul。""",
            parameters={"type": "object", "properties": {
                "action": {"type": "string", "enum": ["read", "patch"], "description": "read=读取当前全局 Soul；patch=最小替换更新全局 Soul"},
                "reason": {"type": "string", "description": "中文说明：为什么这条规则符合全局 Soul，而不是项目 Soul 或普通记忆"},
                "exact": {"type": "string", "description": "patch 时必填：当前全局 Soul 中要被替换的精确文本"},
                "replacement": {"type": "string", "description": "patch 时必填：替换后的文本。必须保留 exact 中仍然有效的内容"},
            }, "required": ["action", "reason"]},
        )),
    ]


async def _load_global_soul() -> str:
    """从数据库加载全局 Soul。如果不存在，初始化默认内容。"""
    try:
        db = await get_db()
        rows = await db.execute_fetchall(
            "SELECT value FROM global_settings WHERE key = ?", (SOUL_DB_KEY,)
        )
        await db.close()
        if rows:
            return rows[0]["value"]
    except Exception:
        pass
    # 首次访问：保存默认内容到数据库
    await _save_global_soul(DEFAULT_GLOBAL_SOUL)
    return DEFAULT_GLOBAL_SOUL


async def _save_global_soul(content: str) -> None:
    """保存全局 Soul 到数据库。"""
    db = await get_db()
    now = int(time.time())
    await db.execute(
        "INSERT OR REPLACE INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)",
        (SOUL_DB_KEY, content, now),
    )
    await db.commit()
    await db.close()


async def execute_global_soul_tool(tool_call: ToolCall, project_id: str) -> ToolResult:
    name = tool_call.name
    args = tool_call.arguments

    try:
        action = args.get("action", "")
        reason = args.get("reason", "").strip()

        if not reason:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="reason 不能为空。必须说明为什么这是跨项目全局 Soul 规则。")

        current_soul = await _load_global_soul()

        if action == "read":
            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={
                "soul": current_soul,
                "action": "read",
            })

        if action != "patch":
            return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"未知 action \"{action}\"。支持 read / patch。")

        exact = args.get("exact", "")
        replacement = args.get("replacement", "")

        if not exact or not replacement:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="patch 需要 exact 和 replacement。")

        first_index = current_soul.find(exact)
        if first_index == -1:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="exact 未在当前全局 Soul 中找到。请先 read 最新内容，再使用精确文本 patch。")

        if current_soul.find(exact, first_index + len(exact)) != -1:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="exact 在当前全局 Soul 中出现多次。请扩大 exact 范围，确保只匹配一处。")

        new_soul = current_soul[:first_index] + replacement + current_soul[first_index + len(exact):]
        await _save_global_soul(new_soul)

        return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={
            "status": "updated",
            "reason": reason,
            "change": {"-": exact, "+": replacement},
        })

    except Exception as e:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=str(e))
