from pydantic import BaseModel
from typing import Optional, Any


class ChatSession(BaseModel):
    id: str
    project_id: str
    title: str
    plan_mode_enabled: bool = False
    thinking_enabled: bool = False
    created_at: int
    last_modified: int


class ChatMessage(BaseModel):
    id: str
    session_id: str
    role: str  # user, model, system
    content: str
    raw_parts: Optional[str] = None
    is_tool_output: bool = False
    skip_in_history: bool = False
    is_error: bool = False
    metadata: Optional[str] = None
    timestamp: int


class ChatRequest(BaseModel):
    project_id: str
    session_id: str
    message: str
