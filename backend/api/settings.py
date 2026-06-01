from fastapi import APIRouter
from pydantic import BaseModel
import json
import time
import uuid

import httpx
from openai import AsyncOpenAI

from ai.compat import (
    RECOMMENDED_BLAZE_BASE_URL,
    friendly_api_error,
    normalize_api_base_url,
    provider_hint_for,
)
from config import settings, CONFIG_FILE
from core.agent.reasoning import ThinkStreamSplitter, get_reasoning_field

router = APIRouter()


LAST_CONNECTION_CHECK: dict = {}


# ─── 数据模型 ──────────────────────────────────────────────

class OpenAIBackend(BaseModel):
    id: str = ""
    name: str = "New Provider"
    base_url: str = ""
    api_key: str = ""
    model_name: str = ""
    max_output_tokens: int | None = None
    context_token_limit: int | None = None
    thinking_enabled: bool = False
    thinking_budget_tokens: int | None = None
    temperature: float = 0.7
    top_p: float = 0.95
    top_k: int = 20


class ModelRoute(BaseModel):
    backend_id: str | None = None
    model_name: str | None = None


class AutoExtraction(BaseModel):
    conversation: bool = True
    document: bool = True
    chapter_analysis: bool = True


class FullAISettings(BaseModel):
    # 当前活跃 provider
    api_key: str = ""
    api_base_url: str = ""
    model: str = ""

    # 多 provider 管理
    backends: list[OpenAIBackend] = []
    active_backend_id: str = ""

    # 全局设置
    max_output_tokens: int | None = None
    context_token_limit: int = 256000
    safety_setting: str = "BLOCK_NONE"
    language: str = "zh"

    # 采样参数
    temperature: float = 0.7
    top_p: float = 0.95
    top_k: int = 20
    thinking_enabled: bool = False
    thinking_budget_tokens: int | None = None

    # 自动提取
    auto_extraction: AutoExtraction = AutoExtraction()

    # 模型路由
    model_routes: dict[str, ModelRoute] = {}

    # 元数据
    has_api_key: bool = False
    provider_hint: str = "openai-compatible"
    recommended_base_url: str = RECOMMENDED_BLAZE_BASE_URL
    last_connection_check: dict | None = None


class TestConnectionRequest(BaseModel):
    api_key: str = ""
    api_base_url: str = ""
    model: str = ""


# ─── 默认 provider 预设 ──────────────────────────────────────

DEFAULT_BACKENDS = [
    OpenAIBackend(
        id="blazeapi",
        name="BlazeAPI",
        base_url="https://blazeai.boxu.dev/api/",
        model_name="qwen3.6-plus",
    ),
    OpenAIBackend(
        id="blaze-thinking",
        name="Blaze Thinking",
        base_url="https://blazeai.boxu.dev/api/",
        model_name="qwen3.6-max-preview-thinking",
    ),
    OpenAIBackend(
        id="skyclaw",
        name="SkyClaw",
        base_url="https://api.apifree.ai/v1",
        model_name="skywork-ai/skyclaw-v1",
    ),
    OpenAIBackend(
        id="deepseek",
        name="DeepSeek",
        base_url="https://api.deepseek.com",
        model_name="deepseek-chat",
    ),
    OpenAIBackend(
        id="openai",
        name="OpenAI",
        base_url="https://api.openai.com/v1",
        model_name="gpt-4o",
    ),
]


# ─── API 端点 ──────────────────────────────────────────────

@router.get("/ai", response_model=FullAISettings)
async def get_ai_settings():
    backends = load_backends()
    active_id = settings.active_backend_id or (backends[0].id if backends else "")
    active = next((b for b in backends if b.id == active_id), backends[0] if backends else OpenAIBackend())

    return FullAISettings(
        api_key="***" if settings.api_key else "",
        api_base_url=settings.api_base_url,
        model=settings.model,
        backends=backends,
        active_backend_id=active_id,
        max_output_tokens=active.max_output_tokens,
        context_token_limit=active.context_token_limit or 256000,
        safety_setting=settings.safety_setting,
        language=settings.language,
        temperature=active.temperature,
        top_p=active.top_p,
        top_k=active.top_k,
        thinking_enabled=active.thinking_enabled,
        thinking_budget_tokens=active.thinking_budget_tokens,
        auto_extraction=AutoExtraction(
            conversation=settings.auto_extract_conversation,
            document=settings.auto_extract_document,
            chapter_analysis=settings.auto_extract_chapter,
        ),
        model_routes=settings.model_routes,
        has_api_key=bool(settings.api_key),
        provider_hint=provider_hint_for(settings.api_base_url),
        last_connection_check=LAST_CONNECTION_CHECK or None,
    )


@router.put("/ai")
async def update_ai_settings(body: FullAISettings):
    # 更新 backends
    if body.backends:
        save_backends(body.backends)

    # 更新活跃 backend
    active_id = body.active_backend_id
    if active_id:
        settings.active_backend_id = active_id
        active = next((b for b in body.backends if b.id == active_id), None)
        if active:
            if active.api_key and active.api_key != "***":
                settings.api_key = active.api_key
            if active.base_url:
                settings.api_base_url = normalize_api_base_url(active.base_url)
            if active.model_name:
                settings.model = active.model_name.strip()

    # 更新全局设置
    if body.api_key and body.api_key != "***":
        settings.api_key = body.api_key
    if body.api_base_url:
        settings.api_base_url = normalize_api_base_url(body.api_base_url)
    if body.model:
        settings.model = body.model.strip()

    settings.safety_setting = body.safety_setting
    settings.language = body.language
    settings.temperature = body.temperature
    settings.top_p = body.top_p
    settings.top_k = body.top_k
    settings.thinking_enabled = body.thinking_enabled
    settings.thinking_budget_tokens = body.thinking_budget_tokens
    settings.auto_extract_conversation = body.auto_extraction.conversation
    settings.auto_extract_document = body.auto_extraction.document
    settings.auto_extract_chapter = body.auto_extraction.chapter_analysis
    settings.model_routes = body.model_routes

    save_settings()
    return {
        "status": "ok",
        "api_base_url": settings.api_base_url,
        "model": settings.model,
        "provider_hint": provider_hint_for(settings.api_base_url),
    }


# ─── 存储 ──────────────────────────────────────────────

def save_settings():
    """将当前设置保存到磁盘。"""
    data = {
        "api_key": settings.api_key,
        "api_base_url": settings.api_base_url,
        "model": settings.model,
        "active_backend_id": settings.active_backend_id,
        "safety_setting": settings.safety_setting,
        "language": settings.language,
        "temperature": settings.temperature,
        "top_p": settings.top_p,
        "top_k": settings.top_k,
        "thinking_enabled": settings.thinking_enabled,
        "thinking_budget_tokens": settings.thinking_budget_tokens,
        "auto_extract_conversation": settings.auto_extract_conversation,
        "auto_extract_document": settings.auto_extract_document,
        "auto_extract_chapter": settings.auto_extract_chapter,
        "model_routes": settings.model_routes,
    }
    CONFIG_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_settings():
    """从磁盘加载设置。"""
    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            if data.get("api_key"):
                settings.api_key = data["api_key"]
            if data.get("api_base_url"):
                settings.api_base_url = normalize_api_base_url(data["api_base_url"])
            if data.get("model"):
                settings.model = data["model"]
            if data.get("active_backend_id"):
                settings.active_backend_id = data["active_backend_id"]
            if data.get("safety_setting"):
                settings.safety_setting = data["safety_setting"]
            if data.get("language"):
                settings.language = data["language"]
            if "temperature" in data:
                settings.temperature = data["temperature"]
            if "top_p" in data:
                settings.top_p = data["top_p"]
            if "top_k" in data:
                settings.top_k = data["top_k"]
            if "thinking_enabled" in data:
                settings.thinking_enabled = data["thinking_enabled"]
            if "thinking_budget_tokens" in data:
                settings.thinking_budget_tokens = data["thinking_budget_tokens"]
            if "auto_extract_conversation" in data:
                settings.auto_extract_conversation = data["auto_extract_conversation"]
            if "auto_extract_document" in data:
                settings.auto_extract_document = data["auto_extract_document"]
            if "auto_extract_chapter" in data:
                settings.auto_extract_chapter = data["auto_extract_chapter"]
            if data.get("model_routes"):
                settings.model_routes = data["model_routes"]
        except Exception:
            pass


def get_backends_file():
    return CONFIG_FILE.parent / "backends.json"


def load_backends() -> list[OpenAIBackend]:
    """加载 provider 列表。"""
    bf = get_backends_file()
    if bf.exists():
        try:
            data = json.loads(bf.read_text(encoding="utf-8"))
            return [OpenAIBackend(**b) for b in data]
        except Exception:
            pass
    return DEFAULT_BACKENDS


def save_backends(backends: list[OpenAIBackend]):
    """保存 provider 列表。"""
    bf = get_backends_file()
    data = [b.model_dump() for b in backends]
    bf.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ─── 模型列表 & 连接测试 ──────────────────────────────────────

@router.get("/models")
async def get_models():
    if not settings.api_key or not settings.api_base_url:
        return {"models": []}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            url = normalize_api_base_url(settings.api_base_url).rstrip("/") + "/models"
            resp = await client.get(url, headers={
                "Authorization": f"Bearer {settings.api_key}",
            })
            resp.raise_for_status()
            data = resp.json()
            models = data.get("data", [])
            return {"models": [{"id": m["id"]} for m in models if "id" in m]}
    except Exception as e:
        return {"models": [], "error": friendly_api_error(e)}


class FetchModelsRequest(BaseModel):
    api_base_url: str = ""
    api_key: str = ""


@router.post("/models")
async def fetch_models(body: FetchModelsRequest):
    """获取指定 Provider 的模型列表。"""
    api_base_url = normalize_api_base_url(body.api_base_url or settings.api_base_url)
    api_key = body.api_key if body.api_key else settings.api_key

    if not api_base_url or not api_key:
        return {"models": []}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            url = api_base_url.rstrip("/") + "/models"
            resp = await client.get(url, headers={
                "Authorization": f"Bearer {api_key}",
            })
            resp.raise_for_status()
            data = resp.json()
            models = data.get("data", [])
            return {"models": [{"id": m["id"]} for m in models if "id" in m]}
    except Exception as e:
        return {"models": [], "error": friendly_api_error(e)}


@router.post("/ai/test-connection")
async def test_ai_connection(body: TestConnectionRequest):
    api_base_url = normalize_api_base_url(body.api_base_url or settings.api_base_url)
    api_key = body.api_key if body.api_key and body.api_key != "***" else settings.api_key
    model = (body.model or settings.model).strip()
    provider_hint = provider_hint_for(api_base_url)

    if not api_base_url:
        return {"ok": False, "provider_hint": provider_hint, "model": model, "error": "请先填写 Base URL。"}
    if not api_key:
        return {"ok": False, "provider_hint": provider_hint, "model": model, "error": "请先填写 API Key。"}
    if not model:
        return {"ok": False, "provider_hint": provider_hint, "model": model, "error": "请先填写模型名称。"}

    supports_streaming = False
    supports_reasoning = False
    has_answer = False
    event_types: list[str] = []
    raw_chunk_fields: list[list[str]] = []

    try:
        client = AsyncOpenAI(api_key=api_key, base_url=api_base_url, timeout=30.0)
        stream = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "请只回复：ok"}],
            temperature=0,
            stream=True,
        )
        splitter = ThinkStreamSplitter()
        async for chunk in stream:
            supports_streaming = True
            raw_chunk_fields.append(sorted(chunk.model_dump(exclude_none=True).keys()))
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            reasoning = get_reasoning_field(delta)
            if reasoning:
                supports_reasoning = True
                event_types.append("reasoning_delta")
            if delta.content:
                for event in splitter.feed(delta.content):
                    event_types.append(event["type"])
                    if event["type"] == "delta" and event["content"].strip():
                        has_answer = True
                    if event["type"] == "reasoning_delta":
                        supports_reasoning = True
            if has_answer and len(event_types) >= 3:
                break
        for event in splitter.flush():
            event_types.append(event["type"])
            if event["type"] == "delta" and event["content"].strip():
                has_answer = True
            if event["type"] == "reasoning_delta":
                supports_reasoning = True

        result = {
            "ok": True,
            "provider_hint": provider_hint,
            "model": model,
            "api_base_url": api_base_url,
            "supports_streaming": supports_streaming,
            "supports_reasoning": supports_reasoning,
            "has_answer": has_answer,
            "event_types": sorted(set(event_types)),
            "raw_chunk_fields": raw_chunk_fields[:3],
            "checked_at": int(time.time()),
        }
    except Exception as e:
        result = {
            "ok": False,
            "provider_hint": provider_hint,
            "model": model,
            "api_base_url": api_base_url,
            "supports_streaming": False,
            "supports_reasoning": False,
            "error": friendly_api_error(e),
            "checked_at": int(time.time()),
        }

    global LAST_CONNECTION_CHECK
    LAST_CONNECTION_CHECK = {k: v for k, v in result.items() if k != "raw_chunk_fields"}
    return result
