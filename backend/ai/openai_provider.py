import asyncio
import logging
from typing import AsyncIterator, Any
from openai import AsyncOpenAI, RateLimitError, APITimeoutError, APIConnectionError, APIStatusError

from config import settings
from ai.provider import AIProvider
from ai.compat import friendly_api_error, normalize_api_base_url
from core.agent.reasoning import ThinkStreamSplitter, get_reasoning_field, split_model_output

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
BASE_DELAY = 1.0  # seconds


async def _retry_with_backoff(coro_factory, max_retries: int = MAX_RETRIES):
    """带指数退避的重试逻辑，仅对瞬态错误重试。超时错误额外增加重试次数。"""
    last_exception = None
    # 超时错误增加重试次数
    effective_max = max_retries + 1 if max_retries == MAX_RETRIES else max_retries
    for attempt in range(effective_max + 1):
        try:
            return await coro_factory()
        except (RateLimitError, APITimeoutError, APIConnectionError) as e:
            last_exception = e
            # 超时错误使用更长的退避时间
            extra_delay = 2.0 if isinstance(e, APITimeoutError) else 0.0
            if attempt < effective_max:
                delay = BASE_DELAY * (2 ** attempt) + extra_delay
                logger.warning(f"API瞬态错误 (attempt {attempt + 1}/{effective_max + 1}): {e}, {delay:.1f}s后重试")
                await asyncio.sleep(delay)
            else:
                logger.error(f"API重试耗尽 ({effective_max + 1}次): {e}")
        except APIStatusError as e:
            if e.status_code >= 500 and attempt < max_retries:
                last_exception = e
                delay = BASE_DELAY * (2 ** attempt)
                logger.warning(f"API服务端错误 {e.status_code} (attempt {attempt + 1}): {delay:.1f}s后重试")
                await asyncio.sleep(delay)
            else:
                raise
    raise RuntimeError(friendly_api_error(last_exception)) from last_exception


def _parse_tool_args(raw_args) -> dict:
    """解析工具调用参数，兼容多种格式。"""
    import json as _json
    import re

    if isinstance(raw_args, dict):
        return raw_args

    if not isinstance(raw_args, str):
        return {"_raw": str(raw_args)}

    # 尝试直接解析
    try:
        result = _json.loads(raw_args)
        if isinstance(result, dict):
            return result
    except (_json.JSONDecodeError, TypeError):
        pass

    # 尝试去除外层引号（双编码情况）
    if raw_args.startswith('"') and raw_args.endswith('"'):
        try:
            inner = _json.loads(raw_args)  # 解析外层引号
            if isinstance(inner, str):
                result = _json.loads(inner)  # 解析内层 JSON
                if isinstance(result, dict):
                    return result
        except (_json.JSONDecodeError, TypeError):
            pass

    # 尝试提取 JSON 对象
    match = re.search(r'\{.*\}', raw_args, re.DOTALL)
    if match:
        try:
            result = _json.loads(match.group())
            if isinstance(result, dict):
                # 如果结果包含 _raw，尝试解析 _raw 的内容
                if "_raw" in result and isinstance(result["_raw"], str):
                    try:
                        inner = _json.loads(result["_raw"])
                        if isinstance(inner, dict):
                            return inner
                    except (_json.JSONDecodeError, TypeError):
                        pass
                return result
        except (_json.JSONDecodeError, TypeError):
            pass

    # 尝试修复 BlazeAI 的转义问题
    # 处理 \\" -> " 的情况
    try:
        unescaped = raw_args.replace('\\"', '"')
        if unescaped.startswith('"') and unescaped.endswith('"'):
            unescaped = unescaped[1:-1]
        result = _json.loads(unescaped)
        if isinstance(result, dict):
            return result
    except (_json.JSONDecodeError, TypeError):
        pass

    # 处理 \\" -> \" -> " 的情况（双重转义）
    try:
        unescaped = raw_args.replace('\\\\"', '"')
        if unescaped.startswith('"') and unescaped.endswith('"'):
            unescaped = unescaped[1:-1]
        result = _json.loads(unescaped)
        if isinstance(result, dict):
            return result
    except (_json.JSONDecodeError, TypeError):
        pass

    # 尝试从 _raw 包装中提取
    if '_raw' in raw_args:
        raw_match = re.search(r"'_raw':\s*'(.*?)'", raw_args, re.DOTALL)
        if raw_match:
            inner = raw_match.group(1)
            # 尝试多种转义修复
            for fix in [inner, inner.replace('\\"', '"'), inner.replace('\\\\"', '"')]:
                try:
                    result = _json.loads(fix)
                    if isinstance(result, dict):
                        return result
                except (_json.JSONDecodeError, TypeError):
                    continue

    return {"_raw": raw_args}


class OpenAIProvider(AIProvider):
    def __init__(self):
        self._client: AsyncOpenAI | None = None
        self._cached_url: str = ""
        self._cached_key: str = ""

    def _get_client(self) -> AsyncOpenAI:
        current_url = normalize_api_base_url(settings.api_base_url)
        current_key = settings.api_key or "sk-placeholder"
        if self._client is None or self._cached_url != current_url or self._cached_key != current_key:
            self._client = AsyncOpenAI(
                api_key=current_key,
                base_url=current_url,
                timeout=180.0,
            )
            self._cached_url = current_url
            self._cached_key = current_key
        return self._client

    async def chat_stream_events(self, messages: list[dict], temperature: float = 0.7) -> AsyncIterator[dict[str, str]]:
        client = self._get_client()

        async def _create_stream():
            return await client.chat.completions.create(
                model=settings.model,
                messages=messages,
                temperature=temperature,
                stream=True,
            )

        stream = await _retry_with_backoff(_create_stream)
        splitter = ThinkStreamSplitter()
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            reasoning = get_reasoning_field(delta)
            if reasoning:
                yield {"type": "reasoning_delta", "content": reasoning}
            if delta.content:
                for event in splitter.feed(delta.content):
                    yield event
        for event in splitter.flush():
            yield event

    async def chat_stream(self, messages: list[dict], temperature: float = 0.7) -> AsyncIterator[str]:
        async for event in self.chat_stream_events(messages, temperature):
            if event["type"] == "delta":
                yield event["content"]

    async def chat(self, messages: list[dict], temperature: float = 0.7, max_tokens: int | None = None) -> str:
        client = self._get_client()

        async def _create():
            kwargs: dict[str, Any] = {
                "model": settings.model,
                "messages": messages,
                "temperature": temperature,
            }
            if max_tokens is not None:
                kwargs["max_tokens"] = max_tokens
            return await client.chat.completions.create(**kwargs)

        response = await _retry_with_backoff(_create)
        msg = response.choices[0].message
        answer, _ = split_model_output(msg.content, get_reasoning_field(msg))
        return answer

    async def chat_with_tools(
        self,
        messages: list[dict],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> dict[str, Any]:
        client = self._get_client()

        # 检测模型是否支持 function calling
        # 已知不支持的模型
        NO_FC_KEYWORDS = ["qwen3.6-plus", "qwen3.6-plus-latest"]
        model_lower = settings.model.lower()
        no_fc = any(kw in model_lower for kw in NO_FC_KEYWORDS)

        if tools and no_fc:
            # 明确不支持 function calling 的模型：直接用嵌入式工具
            return await self._chat_with_tools_embedded(messages, tools, temperature, max_tokens)

        # 使用配置中的 max_output_tokens（如果调用方未指定）
        effective_max_tokens = max_tokens or settings.max_output_tokens or 4096

        kwargs: dict[str, Any] = {
            "model": settings.model,
            "messages": messages,
            "temperature": temperature or settings.temperature,
            "max_tokens": effective_max_tokens,
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
            print(f"[DEBUG] chat_with_tools: {len(tools)} tools, model={settings.model}")

        # SkyClaw 特殊参数
        if "skyclaw" in model_lower:
            kwargs["max_tokens"] = 65536  # SkyClaw 需要大 token 限制
            kwargs["extra_body"] = {
                "top_k": settings.top_k,
                "chat_template_kwargs": {"enable_thinking": settings.thinking_enabled},
            }

        async def _create():
            return await client.chat.completions.create(**kwargs)

        response = await _retry_with_backoff(_create)
        if not response.choices:
            print(f"[DEBUG] No choices in response: {response}")
            return {"content": "", "reasoning_content": "", "tool_calls": None, "finish_reason": None}
        msg = response.choices[0].message
        print(f"[DEBUG] raw_msg: content={repr(msg.content)[:300]}, tool_calls={msg.tool_calls}, finish={response.choices[0].finish_reason}")

        tool_calls = None
        if msg.tool_calls:
            import json as _json
            tool_calls = []
            for tc in msg.tool_calls:
                raw_args = tc.function.arguments
                parsed_args = _parse_tool_args(raw_args)
                tool_calls.append({
                    "id": tc.id,
                    "name": tc.function.name,
                    "arguments": parsed_args,
                })

        reasoning_content = get_reasoning_field(msg)
        content, reasoning_content = split_model_output(msg.content, reasoning_content)
        finish_reason = response.choices[0].finish_reason if response.choices else None

        result = {
            "content": content or "",
            "reasoning_content": reasoning_content or "",
            "tool_calls": tool_calls,
            "finish_reason": finish_reason,
        }

        # BlazeAI 适配：从 content 中提取嵌入式 tool_calls
        from ai.blazeai_adapter import adapt_response, is_blazeai
        if is_blazeai(settings.api_base_url) and not tool_calls and content and '"tool_calls"' in content:
            print(f"[DEBUG] BlazeAI adapter: extracting tool_calls from content")
        result = adapt_response(result, settings.api_base_url)

        # 回退：如果 function calling 失败且 content 暗示工具不可用，尝试嵌入式工具
        if tools and not result.get("tool_calls") and content:
            tool_not_exist_patterns = ["does not exist", "不可用", "无法调用", "工具调用异常", "Tool.*not.*available"]
            import re
            if any(re.search(p, content, re.IGNORECASE) for p in tool_not_exist_patterns):
                print(f"[DEBUG] Function calling failed, falling back to embedded tools")
                return await self._chat_with_tools_embedded(messages, tools, temperature, max_tokens)

        return result

    async def _chat_with_tools_embedded(
        self,
        messages: list[dict],
        tools: list[dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> dict[str, Any]:
        """不支持 function calling 的模型：将工具嵌入 system prompt，让 LLM 输出 JSON 工具调用。"""
        import json as _json

        # 构建工具描述（简化版）
        tool_lines = []
        for t in tools:
            func = t.get("function", t)
            name = func.get("name", "")
            desc = func.get("description", "")[:80]  # 截断描述
            params = func.get("parameters", {})
            param_props = params.get("properties", {})
            required = params.get("required", [])
            param_list = []
            for pname, pinfo in param_props.items():
                ptype = pinfo.get("type", "string")
                req = "*" if pname in required else ""
                param_list.append(f"{pname}:{ptype}{req}")
            tool_lines.append(f"- {name}({', '.join(param_list)}): {desc}")

        tools_text = "\n".join(tool_lines)

        # 在 system prompt 中嵌入工具说明（极简版）
        tool_prompt = f"""## 可用工具

{tools_text}

## 调用规则

当你需要使用工具时，必须输出以下格式的JSON代码块：

```json
{{"tool_calls":[{{"name":"工具名","arguments":{{"参数名":"值"}}}}]}}
```

示例：
```json
{{"tool_calls":[{{"name":"read_file","arguments":{{"path":"世界观/核心设定.md"}}}}]}}
```

同时调用多个工具：
```json
{{"tool_calls":[{{"name":"read_file","arguments":{{"path":"a.md"}}}},{{"name":"glob","arguments":{{"pattern":"*.md"}}}}]}}
```

重要：
1. 工具调用必须放在 ```json 代码块中
2. 不需要工具时直接回复文字
3. 参数值必须是字符串"""

        # 注入到 messages 中
        enhanced_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                enhanced_messages.append({**msg, "content": msg["content"] + "\n\n" + tool_prompt})
            else:
                enhanced_messages.append(msg)
        if not any(m.get("role") == "system" for m in messages):
            enhanced_messages.insert(0, {"role": "system", "content": tool_prompt})

        print(f"[DEBUG] chat_with_tools_embedded: {len(tools)} tools embedded in prompt, model={settings.model}")

        # 调试：打印工具列表
        tool_names = [t.get("function", t).get("name", "") for t in tools]
        print(f"[DEBUG] embedded_tools: {tool_names}")

        client = self._get_client()
        kwargs = {
            "model": settings.model,
            "messages": enhanced_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        async def _create():
            return await client.chat.completions.create(**kwargs)

        response = await _retry_with_backoff(_create)
        if not response.choices:
            print(f"[DEBUG] embedded: No choices in response")
            return {"content": "", "reasoning_content": "", "tool_calls": None, "finish_reason": None}
        msg = response.choices[0].message
        content = msg.content or ""

        # 调试：打印 LLM 输出
        print(f"[DEBUG] embedded_raw: content_len={len(content)}, finish={response.choices[0].finish_reason}")
        print(f"[DEBUG] embedded_content (first 500): {content[:500]}")
        json_match = re.search(r'```json\s*(.*?)\s*```', content, re.DOTALL)
        if json_match:
            try:
                data = _json.loads(json_match.group(1))
                if isinstance(data, dict) and "tool_calls" in data:
                    from ai.blazeai_adapter import _normalize_tool_calls
                    tool_calls = _normalize_tool_calls(data["tool_calls"])
            except (_json.JSONDecodeError, TypeError):
                pass

        if not tool_calls:
            # 尝试直接解析整个 content
            try:
                data = _json.loads(content)
                if isinstance(data, dict) and "tool_calls" in data:
                    from ai.blazeai_adapter import _normalize_tool_calls
                    tool_calls = _normalize_tool_calls(data["tool_calls"])
            except (_json.JSONDecodeError, TypeError):
                pass

        reasoning_content = get_reasoning_field(msg)
        content_clean, reasoning_content = split_model_output(content, reasoning_content)
        finish_reason = response.choices[0].finish_reason if response.choices else None

        return {
            "content": content_clean or "",
            "reasoning_content": reasoning_content or "",
            "tool_calls": tool_calls,
            "finish_reason": finish_reason,
        }
