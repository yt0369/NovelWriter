from pydantic import BaseModel
from typing import Optional


class FileNode(BaseModel):
    name: str
    path: str
    is_dir: bool
    children: list["FileNode"] = []
    size: Optional[int] = None
    protection: Optional[str] = None  # IMMUTABLE, PERSISTENT, AUTO_REBUILD


class FileContent(BaseModel):
    path: str
    content: str


class FilePatch(BaseModel):
    path: str
    old_content: str
    new_content: str
