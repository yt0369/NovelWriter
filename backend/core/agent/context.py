"""
构建 Agent 系统提示词。
组装：Soul + Protocol + 技能索引 + 项目上下文 + 运行时信息。

对标 NovelIDE 的 constructSystemPrompt (coreProtocol.ts)
"""
from pathlib import Path

from db.database import get_db


async def build_system_prompt(project_id: str, project_dir: Path, active_skill_names: set[str] | None = None) -> str:
    """构建Agent系统提示词。"""
    sections = []

    # ─── 1. Soul 层 ───────────────────────────────────────
    sections.append(await _build_soul_section(project_id, project_dir))

    # ─── 2. Protocol 层 ───────────────────────────────────
    sections.append(_build_protocol_section())

    # ─── 3. 技能索引 ─────────────────────────────────────
    sections.append(_build_skills_section(active_skill_names))

    # ─── 4. 运行时上下文 ──────────────────────────────────
    sections.append(await _build_runtime_context(project_id, project_dir))

    return "\n\n".join(s for s in sections if s)


async def _build_soul_section(project_id: str, project_dir: Path) -> str:
    """构建 Soul 层：全局 Soul + 项目 Soul 覆盖。

    对标原项目 constructSystemPrompt 的 soulInstruction 组装：
    - globalSoulInstruction: 从数据库加载全局 Soul（用户可编辑）
    - projectSoulOverride: 从项目目录读取项目级 Soul 覆盖
    """
    from core.tools.global_soul_tools import _load_global_soul

    # 1. 全局 Soul
    try:
        global_soul = await _load_global_soul()
    except Exception:
        from core.skills.definitions.core_protocol import DEFAULT_SOUL
        global_soul = DEFAULT_SOUL

    # 2. 项目 Soul 覆盖
    project_soul_override = ""
    soul_file = project_dir / "规范" / "项目Soul.md"
    if soul_file.exists():
        try:
            soul = soul_file.read_text(encoding="utf-8").strip()
            if soul:
                project_soul_override = f"## 项目 Soul 覆盖\n\n{soul[:1500]}"
        except Exception:
            pass

    # 3. 组装
    parts = [global_soul]
    if project_soul_override:
        parts.append(project_soul_override)
    parts.append("""## 跨项目记忆与风格继承
- Soul 是跨项目人格与协作偏好的主载体
- 默认只继承用户偏好与通用方法论，不自动继承具体作品的角色口吻、专有名词、世界设定
- 作品风格只能软继承：遇到当前项目设定、题材、读者定位或项目 soul 覆盖时，当前项目优先""")

    return "\n\n---\n\n".join(parts)


def _build_protocol_section() -> str:
    """构建 Protocol 层：从 core_protocol 技能文件读取。"""
    from core.skills.definitions.core_protocol import DEFAULT_PROTOCOL
    return DEFAULT_PROTOCOL


def _build_skills_section(active_skill_names: set[str] | None) -> str:
    """构建技能索引：列出所有可用技能的 name + description。

    对标原项目的 <available_skills> 标签：
    - 每轮注入可用技能的元数据（不注入内容，节省 token）
    - 激活的技能在 skills_context 中注入完整内容
    """
    from core.skills.registry import get_all_skills

    all_skills = get_all_skills()
    if not all_skills:
        return ""

    lines = ["<available_skills>"]
    for skill in all_skills:
        active_mark = " [已激活]" if active_skill_names and skill.name in active_skill_names else ""
        lines.append(f"  - {skill.name}: {skill.description}{active_mark}")
    lines.append("</available_skills>")

    return "\n".join(lines)


async def _build_runtime_context(project_id: str, project_dir: Path) -> str:
    """构建运行时上下文。

    对标原项目的 runtimeContext 组装：
    - 项目概况（书名、题材、简介、字数目标）
    - 待办列表
    - 文件目录结构（仅文件夹）
    - 正文字数目标
    """
    sections = ["<runtime_context>"]

    # 1. 项目概况
    project_info = await _build_project_overview(project_id)
    sections.append(project_info)

    # 2. 待办
    todos = await _build_todos(project_id)
    sections.append(todos)

    # 3. 文件目录结构
    folder_tree = _build_folder_tree(project_dir, max_depth=2)
    sections.append(f"## 文件目录结构\n\n{folder_tree or '(暂无文件目录)'}")

    # 4. 正文字数目标
    words_per_chapter = await _get_words_per_chapter(project_id)
    sections.append(f"## 正文字数目标\n{words_per_chapter}")

    sections.append("</runtime_context>")
    return "\n\n".join(sections)


async def _build_project_overview(project_id: str) -> str:
    """构建项目概况。"""
    db = None
    try:
        db = await get_db(project_id)
        rows = await db.execute_fetchall("SELECT * FROM projects WHERE id = ?", (project_id,))

        if not rows:
            return "## 项目概况\n\n(暂无项目概况)"

        project = dict(rows[0])
        lines = ["## 项目概况"]

        name = project.get("name", "")
        if name:
            lines.append(f"- 书名：《{name}》")
            lines.append("- 所有生成内容中的书名必须使用此名称，不得使用其他书名。")

        genre = project.get("genre", "")
        if genre:
            lines.append(f"- 题材：{genre}")

        description = project.get("description", "")
        if description:
            lines.append(f"- 简介：{description[:300]}")

        target_chapters = project.get("target_chapters")
        if target_chapters:
            lines.append(f"- 目标章节数：{target_chapters}")

        chapters_per_volume = project.get("chapters_per_volume")
        if chapters_per_volume:
            lines.append(f"- 每卷章节数：{chapters_per_volume}")

        return "\n".join(lines)
    except Exception:
        return "## 项目概况\n\n(暂无项目概况)"
    finally:
        if db is not None:
            await db.close()


async def _build_todos(project_id: str) -> str:
    """构建待办列表。"""
    db = None
    try:
        db = await get_db(project_id)
        todo_rows = await db.execute_fetchall(
            "SELECT id, text FROM todo_items WHERE project_id = ? AND done = 0 ORDER BY created_at LIMIT 10",
            (project_id,),
        )

        if not todo_rows:
            return "## 待办\n\n> (无待办事项)"

        todos = "\n".join(f"> - [{i}] {dict(r)['text']}" for i, r in enumerate(todo_rows))
        return f"## 待办\n\n{todos}"
    except Exception:
        return "## 待办\n\n> (无待办事项)"
    finally:
        if db is not None:
            await db.close()


async def _get_words_per_chapter(project_id: str) -> str:
    """获取每章字数目标。"""
    db = None
    try:
        db = await get_db(project_id)
        rows = await db.execute_fetchall(
            "SELECT words_per_chapter FROM projects WHERE id = ?",
            (project_id,),
        )

        if rows and rows[0]["words_per_chapter"]:
            return str(rows[0]["words_per_chapter"])
        return "未定"
    except Exception:
        return "未定"
    finally:
        if db is not None:
            await db.close()


def _build_folder_tree(project_dir: Path, max_depth: int = 2) -> str:
    """构建文件夹树形结构。"""
    lines = []
    _scan_dirs(project_dir, lines, "", 0, max_depth)
    return "\n".join(lines)


def _scan_dirs(current: Path, lines: list, prefix: str, depth: int, max_depth: int):
    """递归扫描目录。"""
    if depth >= max_depth:
        return
    try:
        entries = sorted(current.iterdir(), key=lambda p: (not p.is_dir(), p.name))
    except PermissionError:
        return

    dirs = [e for e in entries if e.is_dir() and not e.name.startswith('.') and e.name != '__pycache__']
    for i, d in enumerate(dirs):
        is_last = i == len(dirs) - 1
        connector = "└── " if is_last else "├── "
        lines.append(f"{prefix}{connector}{d.name}/")
        extension = "    " if is_last else "│   "
        _scan_dirs(d, lines, prefix + extension, depth + 1, max_depth)
