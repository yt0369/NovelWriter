"""
消息分类器：对对话消息进行多维度分类和衰减配置。
对标 NovelIDE 的 messageClassifier.ts。

从 compression.py 提取，作为独立模块。
"""
from enum import Enum


class MessageValue(Enum):
    HIGH = "high"      # 永久保留
    MEDIUM = "medium"  # 3-5 轮衰减
    LOW = "low"        # 快速衰减（1-2 轮）


class ContentType(Enum):
    PATH = "path"
    CONTENT = "content"
    DIFF = "diff"
    LIST = "list"
    STATUS = "status"
    TASK = "task"
    ACTION = "action"
    QUERY = "query"
    NOTE = "note"
    THOUGHT = "thought"
    MIXED = "mixed"


# 每种工具类型的 5 个维度衰减配置
# 格式: {tool_name: {dimension: (value_level, decay_rounds)}}
# decay_rounds = -1 表示永久保留
TOOL_DECAY_CONFIGS: dict[str, dict[str, tuple[MessageValue, int]]] = {
    "read_file": {
        "call": (MessageValue.LOW, 2),
        "path": (MessageValue.MEDIUM, 10),
        "content": (MessageValue.MEDIUM, 5),
        "status": (MessageValue.LOW, 2),
        "results": (MessageValue.MEDIUM, 5),
    },
    "write_file": {
        "call": (MessageValue.LOW, 2),
        "path": (MessageValue.MEDIUM, -1),
        "content": (MessageValue.HIGH, -1),
        "status": (MessageValue.LOW, 2),
        "results": (MessageValue.LOW, 2),
    },
    "patch_file": {
        "call": (MessageValue.LOW, 2),
        "path": (MessageValue.MEDIUM, -1),
        "content": (MessageValue.HIGH, -1),
        "status": (MessageValue.LOW, 2),
        "results": (MessageValue.LOW, 2),
    },
    "query_memory": {
        "call": (MessageValue.LOW, 2),
        "path": (MessageValue.LOW, 2),
        "content": (MessageValue.MEDIUM, 5),
        "status": (MessageValue.LOW, 2),
        "results": (MessageValue.MEDIUM, 10),
    },
    "manage_memory": {
        "call": (MessageValue.LOW, 2),
        "path": (MessageValue.LOW, 2),
        "content": (MessageValue.MEDIUM, 5),
        "status": (MessageValue.LOW, 2),
        "results": (MessageValue.LOW, 2),
    },
    "glob": {
        "call": (MessageValue.LOW, 2),
        "path": (MessageValue.LOW, 4),
        "content": (MessageValue.LOW, 2),
        "status": (MessageValue.LOW, 2),
        "results": (MessageValue.LOW, 4),
    },
    "grep": {
        "call": (MessageValue.LOW, 2),
        "path": (MessageValue.LOW, 4),
        "content": (MessageValue.LOW, 2),
        "status": (MessageValue.LOW, 2),
        "results": (MessageValue.LOW, 6),
    },
    "list_characters": {
        "call": (MessageValue.LOW, 2),
        "path": (MessageValue.LOW, 2),
        "content": (MessageValue.LOW, 2),
        "status": (MessageValue.LOW, 2),
        "results": (MessageValue.MEDIUM, 10),
    },
    "get_character_profile": {
        "call": (MessageValue.LOW, 2),
        "path": (MessageValue.MEDIUM, 10),
        "content": (MessageValue.MEDIUM, 10),
        "status": (MessageValue.LOW, 2),
        "results": (MessageValue.MEDIUM, 10),
    },
    "list_events": {
        "call": (MessageValue.LOW, 2),
        "path": (MessageValue.LOW, 2),
        "content": (MessageValue.LOW, 2),
        "status": (MessageValue.LOW, 2),
        "results": (MessageValue.LOW, 8),
    },
    "list_foreshadows": {
        "call": (MessageValue.LOW, 2),
        "path": (MessageValue.LOW, 2),
        "content": (MessageValue.LOW, 2),
        "status": (MessageValue.LOW, 2),
        "results": (MessageValue.LOW, 8),
    },
    "activate_skill": {
        "call": (MessageValue.LOW, 2),
        "path": (MessageValue.LOW, 2),
        "content": (MessageValue.LOW, 2),
        "status": (MessageValue.LOW, 2),
        "results": (MessageValue.MEDIUM, 15),
    },
    "manageTodos": {
        "call": (MessageValue.LOW, 2),
        "path": (MessageValue.LOW, 2),
        "content": (MessageValue.LOW, 2),
        "status": (MessageValue.LOW, 2),
        "results": (MessageValue.MEDIUM, 5),
    },
}

# 默认衰减配置（未列出的工具）
_DEFAULT_DECAY_CONFIG = {
    "call": (MessageValue.LOW, 2),
    "path": (MessageValue.LOW, 4),
    "content": (MessageValue.LOW, 4),
    "status": (MessageValue.LOW, 2),
    "results": (MessageValue.LOW, 4),
}


def get_tool_decay_config(tool_name: str) -> dict[str, tuple[MessageValue, int]]:
    """获取工具的五维衰减配置。"""
    return TOOL_DECAY_CONFIGS.get(tool_name, _DEFAULT_DECAY_CONFIG)


def classify_message_value(msg: dict, tool_call_map: dict | None = None) -> MessageValue:
    """根据消息角色和工具类型判断价值等级。"""
    role = msg.get("role", "")

    if role in ("user", "system"):
        return MessageValue.HIGH

    if role == "tool" and tool_call_map:
        tc_id = msg.get("tool_call_id", "")
        tc_info = tool_call_map.get(tc_id, {})
        tool_name = tc_info.get("name", "")
        config = get_tool_decay_config(tool_name)
        value, _ = config.get("results", (MessageValue.LOW, 4))
        return value

    if role == "assistant":
        if msg.get("tool_calls"):
            return MessageValue.MEDIUM
        return MessageValue.HIGH

    return MessageValue.MEDIUM


def classify_content_type(content: str, tool_name: str = "") -> ContentType:
    """根据内容和工具类型判断内容类型。"""
    if not content:
        return ContentType.MIXED

    if tool_name in ("read_file", "write_file", "patch_file"):
        return ContentType.CONTENT
    if tool_name in ("glob", "grep", "list_files"):
        return ContentType.LIST
    if tool_name in ("query_memory", "manage_memory"):
        return ContentType.QUERY
    if tool_name in ("list_characters", "get_character_profile", "list_events"):
        return ContentType.LIST

    # 基于内容判断
    if len(content) < 50:
        return ContentType.STATUS
    if "。" in content and len(content) > 200:
        return ContentType.CONTENT

    return ContentType.MIXED
