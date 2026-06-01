from abc import ABC, abstractmethod
from typing import AsyncIterator, Any


class AIProvider(ABC):
    @abstractmethod
    async def chat_stream(self, messages: list[dict], temperature: float = 0.7) -> AsyncIterator[str]:
        """Stream chat response chunks."""
        ...

    async def chat_stream_events(self, messages: list[dict], temperature: float = 0.7) -> AsyncIterator[dict[str, str]]:
        """Stream normalized events: delta and reasoning_delta."""
        async for chunk in self.chat_stream(messages, temperature):
            yield {"type": "delta", "content": chunk}

    @abstractmethod
    async def chat(self, messages: list[dict], temperature: float = 0.7, max_tokens: int | None = None) -> str:
        """Complete chat response."""
        ...

    @abstractmethod
    async def chat_with_tools(
        self,
        messages: list[dict],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.7,
    ) -> dict[str, Any]:
        """带工具调用的chat。返回 {"content": str|None, "tool_calls": list|None}"""
        ...
