from urllib.parse import urlparse, urlunparse

import httpx
from openai import APIConnectionError, APIStatusError, APITimeoutError


RECOMMENDED_BLAZE_BASE_URL = "https://blazeai.boxu.dev/api/"


def normalize_api_base_url(url: str) -> str:
    value = (url or "").strip()
    if not value:
        return value
    parsed = urlparse(value)
    hostname = (parsed.hostname or "").lower()
    path = parsed.path.rstrip("/")
    if hostname == "blazeai.boxu.dev" and path == "/api/v1":
        parsed = parsed._replace(path="/api")
    normalized = urlunparse(parsed).rstrip("/")
    if hostname == "blazeai.boxu.dev" and normalized:
        return normalized + "/"
    return normalized


def provider_hint_for(url: str) -> str:
    parsed = urlparse(url or "")
    if (parsed.hostname or "").lower() == "blazeai.boxu.dev":
        return "blazeapi"
    return "openai-compatible"


def friendly_api_error(exc: Exception) -> str:
    if isinstance(exc, APIStatusError):
        status = exc.status_code
        if status in (401, 403):
            return "API Key 无效或无权限，请检查密钥。"
        if status == 404:
            return "模型或接口不存在，请检查 Base URL 和模型名称。"
        if status == 429:
            return "请求被限流或额度不足，请稍后重试。"
        if status >= 500:
            return "上游模型服务暂时不可用，请稍后重试。"
        return f"模型服务返回错误 HTTP {status}。"
    if isinstance(exc, APITimeoutError):
        return "连接模型服务超时，请检查网络或稍后重试。"
    if isinstance(exc, APIConnectionError):
        return "无法连接模型服务，请检查 Base URL 和网络。"
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status in (401, 403):
            return "API Key 无效或无权限，请检查密钥。"
        if status == 404:
            return "模型列表接口不存在，请检查 Base URL。"
        if status == 429:
            return "请求被限流或额度不足，请稍后重试。"
        if status >= 500:
            return "上游模型服务暂时不可用，请稍后重试。"
        return f"模型服务返回错误 HTTP {status}。"
    return str(exc) or "模型连接失败。"
