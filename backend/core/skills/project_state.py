from db.database import get_db
from core.skills.registry import activate_skill, get_active_skill_names, get_all_skills


def _ensure_skills_registered():
    if get_all_skills():
        return
    from core.skills.definitions import register_all_skills

    register_all_skills()


async def get_persisted_project_skill_names(project_id: str) -> set[str]:
    """Return skills explicitly enabled for a project in its database."""
    if not project_id:
        return set()
    db = await get_db(project_id)
    try:
        rows = await db.execute_fetchall(
            """SELECT skill_id FROM project_skill_settings
               WHERE project_id = ? AND enabled = 1""",
            (project_id,),
        )
    finally:
        await db.close()
    return {str(row["skill_id"]) for row in rows if row["skill_id"]}


async def hydrate_project_skills(project_id: str) -> set[str]:
    """Load persisted project skills into the runtime registry and return active names."""
    _ensure_skills_registered()
    for skill_name in await get_persisted_project_skill_names(project_id):
        activate_skill(skill_name, scope=project_id)
    return get_active_skill_names(scope=project_id)


async def get_project_active_skill_names(project_id: str) -> set[str]:
    """Return runtime active skills plus any persisted project-level skills."""
    if not project_id:
        return set()
    return await hydrate_project_skills(project_id)
