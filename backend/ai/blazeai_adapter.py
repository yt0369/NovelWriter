"""
BlazeAI 适配器：处理 BlazeAI API 的非标准行为。

BlazeAI 的 qwen 模型有时会把 tool_calls 放在 content 里返回（JSON 字符串），
而不是标准的 tool_calls 字段。此适配器将这些嵌入式 tool_calls 提取出来。
"""
import json
import re
from typing import Any


def is_blazeai(api_base_url: str) -> bool:
    """检测是否为 BlazeAI 端点。"""
    from ai.compat import provider_hint_for
    return provider_hint_for(api_base_url) == "blazeapi"


def adapt_response(response: dict[str, Any], api_base_url: str) -> dict[str, Any]:
    """
    适配 BlazeAI 的非标准响应。
    如果 content 中包含嵌入式 tool_calls JSON，提取到 tool_calls 字段。
    """
    if not is_blazeai(api_base_url):
        return response

    content = response.get("content", "")
    tool_calls = response.get("tool_calls")

    # 如果已经有标准 tool_calls，不需要适配
    if tool_calls:
        return response

    # 检查 content 是否包含嵌入式 tool_calls
    if not content:
        return response

    extracted = _extract_tool_calls_from_content(content)
    if extracted:
        response["tool_calls"] = extracted
        # 清理 content 中的 tool_calls JSON
        response["content"] = _clean_content(content, extracted)
        print(f"[blazeai_adapter] Extracted {len(extracted)} tool_calls from content")

    return response


def _extract_tool_calls_from_content(content: str) -> list[dict] | None:
    """从 content 中提取嵌入式 tool_calls。"""
    # 尝试直接解析整个 content 为 JSON
    try:
        data = json.loads(content)
        if isinstance(data, dict) and "tool_calls" in data:
            return _normalize_tool_calls(data["tool_calls"])
    except (json.JSONDecodeError, TypeError):
        pass

    # 尝试修复常见的 BlazeAI JSON 问题（arguments 中引号未转义）
    fixed = _try_fix_blazeai_json(content)
    if fixed:
        try:
            data = json.loads(fixed)
            if isinstance(data, dict) and "tool_calls" in data:
                return _normalize_tool_calls(data["tool_calls"])
        except (json.JSONDecodeError, TypeError):
            pass

    # 尝试提取 JSON 块（可能被 markdown 代码块包裹）
    json_patterns = [
        r'```json\s*(\{.*?"tool_calls".*?\})\s*```',
        r'```\s*(\{.*?"tool_calls".*?\})\s*```',
    ]

    for pattern in json_patterns:
        match = re.search(pattern, content, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(1))
                if isinstance(data, dict) and "tool_calls" in data:
                    return _normalize_tool_calls(data["tool_calls"])
            except (json.JSONDecodeError, TypeError):
                continue

    # 检测是否包含 tool_calls 结构（即使 JSON 不合法）
    if '"tool_calls"' not in content:
        return None

    # 使用正则提取 function call 信息（处理 BlazeAI 的非标准 JSON）
    # 匹配 "function": {"name": "xxx", "arguments": ...}
    # BlazeAI 的 arguments 可能是: "..." 或 {...} 或 不合法的 JSON
    func_pattern = r'"function"\s*:\s*\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(.*?)\s*\}\s*\}'
    matches = re.findall(func_pattern, content, re.DOTALL)

    if not matches:
        # 尝试另一种格式：直接 {"name": "xxx", "arguments": ...}
        func_pattern2 = r'"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(.*?)\s*(?:\}|,")'
        matches = re.findall(func_pattern2, content, re.DOTALL)

    if matches:
        tool_calls = []
        for i, (name, args_str) in enumerate(matches):
            # 清理 arguments 字符串
            args_str = args_str.strip().rstrip(',').strip()

            # 尝试解析为 JSON
            try:
                args = json.loads(args_str)
                if isinstance(args, dict):
                    tool_calls.append({"id": f"call_{i}", "name": name, "arguments": args})
                    continue
            except (json.JSONDecodeError, TypeError):
                pass

            # 如果是带引号的字符串（如 "{"message": "hello"}"），尝试提取内部 JSON
            if args_str.startswith('"') and args_str.endswith('"'):
                inner = args_str[1:-1]
                try:
                    args = json.loads(inner)
                    if isinstance(args, dict):
                        tool_calls.append({"id": f"call_{i}", "name": name, "arguments": args})
                        continue
                except (json.JSONDecodeError, TypeError):
                    pass

            # 尝试用正则提取 JSON 对象
            json_match = re.search(r'\{.*\}', args_str, re.DOTALL)
            if json_match:
                try:
                    args = json.loads(json_match.group())
                    if isinstance(args, dict):
                        tool_calls.append({"id": f"call_{i}", "name": name, "arguments": args})
                        continue
                except (json.JSONDecodeError, TypeError):
                    pass

            # 尝试修复转义问题：将 \\" 替换为 "
            try:
                unescaped = args_str.replace('\\"', '"')
                if unescaped.startswith('"') and unescaped.endswith('"'):
                    unescaped = unescaped[1:-1]
                args = json.loads(unescaped)
                if isinstance(args, dict):
                    tool_calls.append({"id": f"call_{i}", "name": name, "arguments": args})
                    continue
            except (json.JSONDecodeError, TypeError):
                pass

            # 兜底：保存原始字符串
            tool_calls.append({"id": f"call_{i}", "name": name, "arguments": {"_raw": args_str}})

        return tool_calls

    return None


def _normalize_tool_calls(raw_calls: list) -> list[dict]:
    """标准化 tool_calls 格式。"""
    from ai.openai_provider import _parse_tool_args
    result = []
    for i, tc in enumerate(raw_calls):
        if isinstance(tc, dict):
            func = tc.get("function", tc)
            name = func.get("name", tc.get("name", ""))
            args = func.get("arguments", tc.get("arguments", {}))

            # 使用统一的参数解析
            args = _parse_tool_args(args)

            result.append({
                "id": tc.get("id", f"call_{i}"),
                "name": name,
                "arguments": args,
            })
    return result


def _try_fix_blazeai_json(content: str) -> str | None:
    """尝试修复 BlazeAI 的非标准 JSON（arguments 中引号未转义）。"""
    # 模式：{"tool_calls": [{"function": {"name": "xxx", "arguments": "{"key": "value"}"}}]}
    # 需要将 arguments 的值从 "{"key": "value"}" 转义为 "{\"key\": \"value\"}"
    pattern = r'("arguments"\s*:\s*)"(\{.*?\})"'
    match = re.search(pattern, content, re.DOTALL)
    if match:
        # 提取 arguments 的值
        args_str = match.group(2)
        # 转义内部引号
        escaped_args = args_str.replace('"', '\\"')
        # 替换整个 arguments 值
        fixed = content[:match.start(2)] + escaped_args + content[match.end(2):]
        return fixed
    return None


def _clean_content(content: str, extracted_calls: list[dict]) -> str:
    """清理 content 中的 tool_calls JSON，保留纯文本部分。"""
    # 如果整个 content 就是 JSON，清空
    try:
        data = json.loads(content)
        if isinstance(data, dict) and "tool_calls" in data:
            return data.get("text", "") or ""
    except (json.JSONDecodeError, TypeError):
        pass

    # 移除 markdown 代码块中的 JSON
    cleaned = re.sub(r'```json\s*\{.*?"tool_calls".*?\}\s*```', '', content, flags=re.DOTALL)
    cleaned = re.sub(r'```\s*\{.*?"tool_calls".*?\}\s*```', '', cleaned, flags=re.DOTALL)

    # 移除内联 JSON
    for tc in extracted_calls:
        name = tc.get("name", "")
        if name:
            # 移除包含此工具名的 JSON 块
            pattern = re.escape(json.dumps({"name": name})) + r'[^}]*\}'
            cleaned = re.sub(pattern, '', cleaned, flags=re.DOTALL)

    return cleaned.strip()
