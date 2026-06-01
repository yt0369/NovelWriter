"""
深度思考工具：管理"3页虚拟纸"的思考空间。
P1 约束分析 + P2 广度枚举 + P3 深度评估。
"""
import json
import time
import uuid
from pathlib import Path

from models.tools import ToolDefinition, ToolFunction, ToolCall, ToolResult, ToolResultStatus


def get_deep_thinking_tool_definitions() -> list[ToolDefinition]:
    return [
        ToolDefinition(function=ToolFunction(
            name="deep_thinking",
            description="""深度分析工具。用于**需要结构化思考的创意决策**，不是每轮必调。

管理"3页虚拟纸"的思考空间：
- P1 约束分析 + 意图揣测（.thinking/{标题}/01_约束.md）
- P2 广度枚举（.thinking/{标题}/02_广度.md）：至少3个方案变体
- P3 深度评估（.thinking/{标题}/03_深度.md）：必须给出推荐结论

必须使用的场景（只有这3种）：
1. 用户明确要求"仔细想想"/"深度分析"/"认真考虑"/"想清楚"/"推倒重来"
2. 从零设计核心架构（主角金手指、世界观底层规则、核心冲突机制）
3. 根本性重构（重做整个设定体系）

不需要的场景：用户纠正→直接修改、规划单章→直接规划、多方案选择→直接选一个执行。""",
            parameters={"type": "object", "properties": {
                "title": {"type": "string", "description": "思考主题标题"},
                "page": {"type": "string", "enum": ["p1_constraint", "p2_breadth", "p3_depth"], "description": "写入哪一页：p1_constraint（约束分析）、p2_breadth（广度枚举）、p3_depth（深度评估）"},
                "content": {"type": "string", "description": "该页的思考内容（Markdown格式）"},
                "action": {"type": "string", "enum": ["write", "read", "archive"], "description": "操作类型：write（写入内容）、read（读取所有页）、archive（归档完成的思考）"},
            }, "required": ["title", "action"]},
        )),
    ]


async def execute_deep_thinking_tool(tool_call: ToolCall, project_id: str) -> ToolResult:
    name = tool_call.name
    args = tool_call.arguments

    try:
        title = args.get("title", "")
        action = args.get("action", "write")
        page = args.get("page", "")
        content = args.get("content", "")

        if not title:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="缺少思考主题标题")

        # 思考文件存储在项目的 .thinking/ 目录下
        from config import settings
        project_dir = settings.projects_dir / project_id
        thinking_dir = project_dir / ".thinking"
        slug = _title_to_slug(title)
        pad_dir = thinking_dir / slug

        if action == "write":
            if not page:
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="缺少 page 参数")
            if not content:
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error="缺少 content 参数")

            pad_dir.mkdir(parents=True, exist_ok=True)
            page_file = pad_dir / f"{_page_filename(page)}"
            page_file.write_text(content, encoding="utf-8")

            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={
                "status": "written",
                "page": page,
                "path": str(page_file.relative_to(project_dir)),
                "title": title,
            })

        elif action == "read":
            if not pad_dir.exists():
                return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={
                    "title": title,
                    "pages": {},
                    "status": "empty",
                })

            pages = {}
            for page_file in sorted(pad_dir.glob("*.md")):
                pages[page_file.stem] = page_file.read_text(encoding="utf-8")

            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={
                "title": title,
                "pages": pages,
                "status": "exists",
            })

        elif action == "archive":
            if not pad_dir.exists():
                return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"思考空间不存在: {title}")

            # 将 3 页合并为一个归档文件
            pages = {}
            for page_file in sorted(pad_dir.glob("*.md")):
                pages[page_file.stem] = page_file.read_text(encoding="utf-8")

            archive_dir = thinking_dir / "_archive"
            archive_dir.mkdir(parents=True, exist_ok=True)
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            archive_file = archive_dir / f"{timestamp}_{slug}.md"

            merged = f"# 深度分析：{title}\n\n"
            page_names = {"01_约束": "P1 约束分析", "02_广度": "P2 广度枚举", "03_深度": "P3 深度评估"}
            for page_key, page_label in page_names.items():
                if page_key in pages:
                    merged += f"## {page_label}\n\n{pages[page_key]}\n\n---\n\n"

            archive_file.write_text(merged, encoding="utf-8")

            # 删除原始 pad 目录
            import shutil
            shutil.rmtree(pad_dir)

            return ToolResult(status=ToolResultStatus.EXECUTED, tool_name=name, result={
                "status": "archived",
                "archive_path": str(archive_file.relative_to(project_dir)),
                "title": title,
            })

        else:
            return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=f"未知操作: {action}")

    except Exception as e:
        return ToolResult(status=ToolResultStatus.ERROR, tool_name=name, error=str(e))


def _title_to_slug(title: str) -> str:
    """将标题转为文件系统安全的 slug。"""
    import re
    slug = re.sub(r'[^\w一-鿿-]', '_', title)
    slug = re.sub(r'_+', '_', slug).strip('_')
    return slug[:50] or "untitled"


def _page_filename(page: str) -> str:
    """将 page 参数映射为文件名。"""
    mapping = {
        "p1_constraint": "01_约束.md",
        "p2_breadth": "02_广度.md",
        "p3_depth": "03_深度.md",
    }
    return mapping.get(page, f"{page}.md")
