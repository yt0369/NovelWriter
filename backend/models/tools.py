from pydantic import BaseModel
from typing import Any, Optional, Literal
from enum import Enum


class ToolParameter(BaseModel):
    type: str
    description: str = ""
    enum: list[str] | None = None
    properties: dict[str, Any] | None = None
    required: list[str] | None = None


class ToolFunction(BaseModel):
    name: str
    description: str
    parameters: dict[str, Any] | None = None


class ToolDefinition(BaseModel):
    type: Literal["function"] = "function"
    function: ToolFunction


class ToolCall(BaseModel):
    id: str
    name: str
    arguments: dict[str, Any]


class ToolResultStatus(str, Enum):
    EXECUTED = "executed"
    APPROVAL_REQUIRED = "approval_required"
    ERROR = "error"


class PendingChange(BaseModel):
    id: str
    tool_name: str
    file_path: str
    original_content: str
    new_content: str
    description: str
    metadata: dict[str, Any] | None = None


class ToolResult(BaseModel):
    status: ToolResultStatus
    tool_name: str
    result: Any = None
    error: str | None = None
    pending_change: PendingChange | None = None


class AgentStep(BaseModel):
    thinking: str = ""
    intent: str = ""
    plan: str = ""
    tool_calls: list[ToolCall] = []
    response: str = ""


# WebSocket message types
class WSMessageType(str, Enum):
    DELTA = "delta"
    TOOL_CALL_START = "tool_call_start"
    TOOL_CALL_RESULT = "tool_call_result"
    APPROVAL_REQUIRED = "approval_required"
    AGENT_DONE = "agent_done"
    ERROR = "error"


class WSMessage(BaseModel):
    type: WSMessageType
    data: Any = None
