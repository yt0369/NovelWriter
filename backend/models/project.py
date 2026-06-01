from pydantic import BaseModel
from typing import Optional


class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    genre: Optional[str] = None
    words_per_chapter: int = 3000
    target_chapters: Optional[int] = None
    chapters_per_volume: int = 10
    preset_id: Optional[str] = None
    core_gameplay_tags: list[str] = []
    narrative_element_tags: list[str] = []
    style_tone_tags: list[str] = []
    romance_line_tags: list[str] = []


class ProjectMeta(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    genre: Optional[str] = None
    words_per_chapter: int = 3000
    target_chapters: Optional[int] = None
    chapters_per_volume: int = 10
    preset_id: Optional[str] = None
    tags: dict = {}
    created_at: int
    last_modified: int
