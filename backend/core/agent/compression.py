"""
上下文压缩模块：当对话历史超出token预算时，对旧消息进行摘要压缩。
支持五维衰减模型、压缩节点格式、生命周期管理和窗口完整性修复。

对标 NovelIDE 的 contextCompression.ts + messageClassifier.ts + toolLifecycle.ts + windowing.ts。
"""
import json
import re
import time
from enum import Enum
from dataclasses import dataclass, field

from utils.token_estimator import estimate_tokens

DEFAULT_TOKEN_BUDGET = 6000
DEFAULT_PRESERVE_ROUNDS = 5

CONSTRAINT_KEYWORDS = ["必须", "不要", "禁止", "不能", "务必", "一定", "绝不", "千万", "切记", "注意", "避免", "不可"]

_CONSTRAINT_PATTERN = re.compile(
    r'[^。！？；\n]*(' + '|'.join(CONSTRAINT_KEYWORDS) + r')[^。！？；\n]*'
)


# ─── 消息价值枚举 ─────────────────────────────────────────────

class MessageValue(Enum):
    HIGH = "high"      # 永久保留
    MEDIUM = "medium"  # 3-5 轮衰减
    LOW = "low"        # 快速衰减（1-2 轮）


# ─── 五维衰减模型 ─────────────────────────────────────────────

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
        # 取 results 维度的值作为整体判断
        value, _ = config.get("results", (MessageValue.LOW, 4))
        return value

    if role == "assistant":
        if msg.get("tool_calls"):
            return MessageValue.MEDIUM
        return MessageValue.HIGH

    return MessageValue.MEDIUM


# ─── 生命周期管理器 ───────────────────────────────────────────

class ToolLifecycleLevel(Enum):
    COMPLETE = 0   # 完整内容
    HALF = 1       # 截断 50%
    QUARTER = 2    # 只保留摘要
    DEAD = 3       # 移除


TOOL_DECAY_STRATEGY = {
    ToolLifecycleLevel.HALF: "truncate",
    ToolLifecycleLevel.QUARTER: "summarize",
    ToolLifecycleLevel.DEAD: "remove",
}


@dataclass
class LifecycleEntry:
    msg_id: str
    tool_name: str
    round_added: int
    decay_rounds: int
    value_level: MessageValue
    is_alive: bool = True
    attenuation_level: int = 0  # 0=完整, 1=50%, 2=75%


class LifecycleManager:
    """按轮次管理消息生命周期。对标 NovelIDE 的 LifecycleManager。"""

    def __init__(self):
        self.entries: dict[str, LifecycleEntry] = {}
        self.current_round: int = 0

    def advance_round(self):
        """每轮用户消息后调用，更新所有条目状态。"""
        self.current_round += 1
        dead_ids = []
        for msg_id, entry in self.entries.items():
            if not entry.is_alive:
                continue
            if entry.decay_rounds <= 0:
                continue  # 永久保留

            age = self.current_round - entry.round_added
            if age >= entry.decay_rounds:
                entry.is_alive = False
                dead_ids.append(msg_id)
            elif age >= entry.decay_rounds * 0.6:
                entry.attenuation_level = 2
            elif age >= entry.decay_rounds * 0.3:
                entry.attenuation_level = 1

        for msg_id in dead_ids:
            del self.entries[msg_id]

    def register_message(self, msg_id: str, tool_name: str, dimension: str = "results"):
        """注册一条工具消息的生命周期。"""
        config = get_tool_decay_config(tool_name)
        value, decay_rounds = config.get(dimension, (MessageValue.LOW, 4))
        self.entries[msg_id] = LifecycleEntry(
            msg_id=msg_id,
            tool_name=tool_name,
            round_added=self.current_round,
            decay_rounds=decay_rounds,
            value_level=value,
        )

    def get_attenuated_content(self, msg_id: str, content: str) -> str:
        """根据衰减等级返回处理后的内容。"""
        entry = self.entries.get(msg_id)
        if not entry or not entry.is_alive:
            return content

        if entry.attenuation_level == 0:
            return content
        elif entry.attenuation_level == 1:
            # 截断 50%
            if len(content) > 200:
                return content[:100] + "...[已衰减]"
            return content
        else:
            # 只保留首句
            first_sentence = content.split("。")[0] + "。" if content else ""
            return f"[摘要] {first_sentence}"

    def is_alive(self, msg_id: str) -> bool:
        entry = self.entries.get(msg_id)
        return entry.is_alive if entry else True


# 全局生命周期管理器实例（按 session 隔离）
_lifecycle_managers: dict[str, LifecycleManager] = {}


def get_lifecycle_manager(session_id: str = "") -> LifecycleManager:
    """获取或创建 session 级别的生命周期管理器。"""
    if session_id not in _lifecycle_managers:
        _lifecycle_managers[session_id] = LifecycleManager()
    return _lifecycle_managers[session_id]


# ─── 工具完整性修复 ───────────────────────────────────────────

def fix_tool_integrity(messages: list[dict]) -> list[dict]:
    """清理孤立的 tool_call 和 tool_response。"""
    call_ids = set()
    response_ids = set()

    for msg in messages:
        if msg.get("role") == "assistant" and msg.get("tool_calls"):
            for tc in msg["tool_calls"]:
                call_ids.add(tc.get("id", ""))
        if msg.get("role") == "tool":
            response_ids.add(msg.get("tool_call_id", ""))

    orphan_responses = response_ids - call_ids
    orphan_calls = call_ids - response_ids

    if not orphan_responses and not orphan_calls:
        return messages

    result = []
    for msg in messages:
        if msg.get("role") == "tool" and msg.get("tool_call_id", "") in orphan_responses:
            continue
        if msg.get("role") == "assistant" and msg.get("tool_calls"):
            filtered_tcs = [tc for tc in msg["tool_calls"] if tc.get("id", "") not in orphan_calls]
            if not filtered_tcs:
                continue
            msg = {**msg, "tool_calls": filtered_tcs}
        result.append(msg)

    return result


def fix_window_start(messages: list[dict]) -> list[dict]:
    """移除开头的 assistant tool_calls 消息（API 要求首条必须是 user 或 system）。"""
    while messages and messages[0].get("role") == "assistant" and messages[0].get("tool_calls"):
        messages = messages[1:]
    return messages


def fix_window_integrity(messages: list[dict]) -> list[dict]:
    """修复窗口完整性：移除孤立的 tool_call/tool_response，修复开头。"""
    messages = fix_tool_integrity(messages)
    messages = fix_window_start(messages)
    return messages


# ─── 辅助函数 ─────────────────────────────────────────────────

def _extract_constraints(text: str) -> list[str]:
    matches = _CONSTRAINT_PATTERN.finditer(text)
    return list(dict.fromkeys(m.group(0).strip() for m in matches))


def _build_tool_call_map(messages: list[dict]) -> dict[str, dict]:
    tool_map = {}
    for msg in messages:
        if msg.get("role") == "assistant" and msg.get("tool_calls"):
            for tc in msg["tool_calls"]:
                func = tc.get("function", {})
                tool_name = func.get("name", "")
                try:
                    arguments = json.loads(func.get("arguments", "{}"))
                except (json.JSONDecodeError, TypeError):
                    arguments = {}
                tool_map[tc.get("id", "")] = {"name": tool_name, "arguments": arguments}
    return tool_map


def _compress_tool_result(tool_name: str, arguments: dict) -> str:
    if re.search(r'read_file', tool_name):
        return f"[已读取: {arguments.get('path', arguments.get('file_path', ''))}]"
    if re.search(r'write_file', tool_name):
        return f"[已写入: {arguments.get('path', arguments.get('file_path', ''))}]"
    if re.search(r'patch_file', tool_name):
        return f"[已修改: {arguments.get('path', arguments.get('file_path', ''))}]"
    if re.search(r'query_memory', tool_name):
        return f"[已查询记忆: {arguments.get('query', '')}]"
    if re.search(r'list_characters', tool_name):
        return f"[已列出角色]"
    if re.search(r'get_character_profile', tool_name):
        return f"[已查询角色: {arguments.get('name', '')}]"
    return f"[工具调用: {tool_name}]"


def _extract_document_refs(messages: list[dict]) -> dict[str, list[str]]:
    """从工具调用中提取文档引用（读取/写入的文件路径）。"""
    refs = {"read": [], "write": []}
    tool_call_map = _build_tool_call_map(messages)

    for msg in messages:
        if msg.get("role") != "tool":
            continue
        tc_id = msg.get("tool_call_id", "")
        tc_info = tool_call_map.get(tc_id, {})
        tool_name = tc_info.get("name", "")
        args = tc_info.get("arguments", {})
        path = args.get("path", args.get("file_path", ""))
        if not path:
            continue

        if "read" in tool_name:
            if path not in refs["read"]:
                refs["read"].append(path)
        elif "write" in tool_name or "patch" in tool_name:
            if path not in refs["write"]:
                refs["write"].append(path)

    return refs


# ─── 压缩节点格式 ─────────────────────────────────────────────

def _build_compression_node(old_msgs: list[dict], tool_call_map: dict) -> str:
    """构建结构化压缩节点（对标 NovelIDE 的 contextCompression.ts）。"""
    user_quotes = []
    constraints = []
    actions = []
    findings = []
    tool_summaries = []
    doc_refs = _extract_document_refs(old_msgs)

    for msg in old_msgs:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if not content:
            continue

        if role == "user":
            # 用户引用（取前 80 字符）
            quote = content[:80].replace("\n", " ")
            if quote:
                user_quotes.append(f'"{quote}"')
            constraints.extend(_extract_constraints(content))

        elif role == "assistant":
            constraints.extend(_extract_constraints(content))
            if content.strip():
                # 关键决策（取前 100 字符）
                decision = content[:100].replace("\n", " ")
                if decision:
                    findings.append(decision)
            if msg.get("tool_calls"):
                for tc in msg["tool_calls"]:
                    func = tc.get("function", {})
                    tname = func.get("name", "")
                    try:
                        targs = json.loads(func.get("arguments", "{}"))
                    except (json.JSONDecodeError, TypeError):
                        targs = {}
                    actions.append(_compress_tool_result(tname, targs))

        elif role == "tool":
            tc_id = msg.get("tool_call_id", "")
            tc_info = tool_call_map.get(tc_id, {})
            tname = tc_info.get("name", "unknown")
            targs = tc_info.get("arguments", {})
            summary = _compress_tool_result(tname, targs)
            if summary not in tool_summaries:
                tool_summaries.append(summary)

    # 构建结构化摘要
    sections = ["[对话压缩摘要]"]

    if user_quotes:
        sections.append("【用户引用】" + " | ".join(user_quotes[:3]))

    if constraints:
        unique_constraints = list(dict.fromkeys(constraints))
        sections.append("【用户约束】")
        sections.extend(f"- {c}" for c in unique_constraints[:5])

    if actions:
        sections.append("【已完成操作】")
        sections.extend(f"- {a}" for a in actions[:8])

    if findings:
        sections.append("【关键发现/决策】")
        sections.extend(f"- {f}" for f in findings[:5])

    if doc_refs["read"] or doc_refs["write"]:
        sections.append("【近期文档引用】")
        if doc_refs["read"]:
            sections.append(f"读取: {', '.join(doc_refs['read'][:5])}")
        if doc_refs["write"]:
            sections.append(f"写入: {', '.join(doc_refs['write'][:5])}")

    if tool_summaries:
        sections.append("【工具结果摘要】")
        sections.extend(f"- {s}" for s in tool_summaries[:5])

    return "\n".join(sections)


# ─── 主压缩函数 ───────────────────────────────────────────────

def compress_messages(
    messages: list[dict],
    token_budget: int = DEFAULT_TOKEN_BUDGET,
    session_id: str = "",
    preserve_rounds: int = DEFAULT_PRESERVE_ROUNDS,
) -> list[dict]:
    """
    压缩消息列表以适配token预算。

    策略（对标 NovelIDE）：
    1. 修复窗口完整性（孤立 tool_call/tool_response + 开头修复）
    2. 保留系统消息不动
    3. 保留最近 N 轮用户消息不动
    4. 对旧消息构建结构化压缩节点
    5. 当token超过预算80%时自动触发压缩
    """
    if not messages:
        return messages

    # 修复窗口完整性
    messages = fix_window_integrity(messages)

    system_msgs = [m for m in messages if m.get("role") == "system"]
    chat_msgs = [m for m in messages if m.get("role") != "system"]

    if not chat_msgs:
        return messages

    total_tokens = sum(estimate_tokens(m.get("content", "")) for m in messages)

    if total_tokens <= token_budget * 0.8:
        return messages

    # 找到保留起点（保留最近 N 轮用户消息）
    user_msg_indices = [i for i, m in enumerate(chat_msgs) if m.get("role") == "user"]
    if len(user_msg_indices) > preserve_rounds:
        preserve_start = user_msg_indices[-preserve_rounds]
    else:
        preserve_start = 0

    recent_msgs = chat_msgs[preserve_start:]
    old_msgs = chat_msgs[:preserve_start]

    if not old_msgs:
        return messages

    # 生命周期管理：对旧消息应用衰减
    if session_id:
        lm = get_lifecycle_manager(session_id)
        lm.advance_round()
        tool_call_map_for_lifecycle = _build_tool_call_map(old_msgs)
        for msg in old_msgs:
            if msg.get("role") == "tool":
                tc_id = msg.get("tool_call_id", "")
                tc_info = tool_call_map_for_lifecycle.get(tc_id, {})
                tool_name = tc_info.get("name", "")
                if tool_name:
                    lm.register_message(tc_id, tool_name, "results")
        old_msgs = apply_tool_lifecycle(old_msgs, lm.current_round)

    # 构建压缩节点
    tool_call_map = _build_tool_call_map(old_msgs)
    compression_node = _build_compression_node(old_msgs, tool_call_map)

    # 检查压缩是否划算
    compression_tokens = estimate_tokens(compression_node)
    old_tokens = sum(estimate_tokens(m.get("content", "")) for m in old_msgs)

    if compression_tokens >= old_tokens:
        # 压缩不划算，直接丢弃旧消息
        compressed = system_msgs + recent_msgs
    else:
        # 将压缩摘要合并到 system message 末尾（避免多个 system message）
        if system_msgs:
            merged_system = {**system_msgs[0], "content": system_msgs[0]["content"] + "\n\n## 对话历史摘要\n" + compression_node}
            compressed = [merged_system] + recent_msgs
        else:
            compressed = [{"role": "system", "content": compression_node}] + recent_msgs

    # 最终检查：如果仍然超预算，进一步裁剪
    new_total = sum(estimate_tokens(m.get("content", "")) for m in compressed)
    if new_total > token_budget and len(recent_msgs) > 2:
        if system_msgs:
            merged_system = {**system_msgs[0], "content": system_msgs[0]["content"] + "\n\n## 对话历史摘要\n" + compression_node}
            return [merged_system] + recent_msgs[-2:]
        return [{"role": "system", "content": compression_node}] + recent_msgs[-2:]

    return compressed
