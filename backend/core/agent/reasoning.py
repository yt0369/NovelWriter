import re
from typing import Any


THINK_TAG_RE = re.compile(r"<think>(.*?)</think>", re.DOTALL | re.IGNORECASE)
OPEN_TAG = "<think>"
CLOSE_TAG = "</think>"


def split_think_tags(content: str | None) -> tuple[str, str]:
    """Return (reasoning, answer) from text that may contain <think> blocks."""
    text = content or ""
    reasoning_parts = [m.group(1).strip() for m in THINK_TAG_RE.finditer(text) if m.group(1).strip()]
    answer = THINK_TAG_RE.sub("", text).strip()
    return "\n\n".join(reasoning_parts), answer


def get_reasoning_field(obj: Any) -> str:
    """Read reasoning_content from OpenAI-compatible SDK objects."""
    value = getattr(obj, "reasoning_content", None)
    if value:
        return str(value)
    extra = getattr(obj, "model_extra", None)
    if isinstance(extra, dict) and extra.get("reasoning_content"):
        return str(extra["reasoning_content"])
    if isinstance(obj, dict) and obj.get("reasoning_content"):
        return str(obj["reasoning_content"])
    return ""


def split_model_output(content: str | None, reasoning_content: str | None = None) -> tuple[str, str]:
    """Normalize model output into (answer, reasoning)."""
    tag_reasoning, answer = split_think_tags(content)
    reasoning_parts = []
    if reasoning_content:
        reasoning_parts.append(str(reasoning_content).strip())
    if tag_reasoning:
        reasoning_parts.append(tag_reasoning)
    return answer, "\n\n".join(part for part in reasoning_parts if part)


def _find_ci(text: str, needle: str) -> int:
    return text.lower().find(needle)


class ThinkStreamSplitter:
    """Split streamed text into answer/reasoning events even when tags cross chunk boundaries."""

    def __init__(self):
        self.buffer = ""
        self.in_think = False
        self.tail = max(len(OPEN_TAG), len(CLOSE_TAG)) - 1

    def feed(self, text: str) -> list[dict[str, str]]:
        if not text:
            return []
        self.buffer += text
        events: list[dict[str, str]] = []

        while self.buffer:
            if self.in_think:
                close_idx = _find_ci(self.buffer, CLOSE_TAG)
                if close_idx >= 0:
                    reasoning = self.buffer[:close_idx]
                    if reasoning:
                        events.append({"type": "reasoning_delta", "content": reasoning})
                    self.buffer = self.buffer[close_idx + len(CLOSE_TAG):]
                    self.in_think = False
                    continue
                if len(self.buffer) > self.tail:
                    emit = self.buffer[:-self.tail]
                    self.buffer = self.buffer[-self.tail:]
                    if emit:
                        events.append({"type": "reasoning_delta", "content": emit})
                break

            open_idx = _find_ci(self.buffer, OPEN_TAG)
            if open_idx >= 0:
                answer = self.buffer[:open_idx]
                if answer:
                    events.append({"type": "delta", "content": answer})
                self.buffer = self.buffer[open_idx + len(OPEN_TAG):]
                self.in_think = True
                continue
            if len(self.buffer) > self.tail:
                emit = self.buffer[:-self.tail]
                self.buffer = self.buffer[-self.tail:]
                if emit:
                    events.append({"type": "delta", "content": emit})
            break

        return events

    def flush(self) -> list[dict[str, str]]:
        if not self.buffer:
            return []
        event_type = "reasoning_delta" if self.in_think else "delta"
        content = self.buffer
        self.buffer = ""
        return [{"type": event_type, "content": content}]
