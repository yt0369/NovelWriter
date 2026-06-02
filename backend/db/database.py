import aiosqlite
from contextlib import asynccontextmanager
from pathlib import Path
from config import settings

_shared_db_path: Path | None = None


def get_shared_db_path() -> Path:
    global _shared_db_path
    if _shared_db_path is None:
        db_dir = settings.projects_dir / ".shared"
        db_dir.mkdir(parents=True, exist_ok=True)
        _shared_db_path = db_dir / "novelwriter.db"
    return _shared_db_path


def get_project_db_path(project_id: str) -> Path:
    return settings.projects_dir / project_id / ".novelwriter" / "project.db"


_initialized_dbs: set[str] = set()


async def get_db(project_id: str | None = None) -> aiosqlite.Connection:
    if project_id:
        db_path = get_project_db_path(project_id)
    else:
        db_path = get_shared_db_path()

    db_path.parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")

    db_key = project_id or "__shared__"
    if db_key not in _initialized_dbs:
        schema_path = Path(__file__).parent / "schema.sql"
        schema = schema_path.read_text(encoding="utf-8")
        await db.executescript(schema)
        await _run_lightweight_migrations(db)
        await db.commit()
        _initialized_dbs.add(db_key)

    return db


async def _run_lightweight_migrations(db: aiosqlite.Connection):
    """Apply additive migrations for existing project databases."""
    columns = await db.execute_fetchall("PRAGMA table_info(pending_changes)")
    names = {row["name"] for row in columns}
    if "metadata" not in names:
        await db.execute("ALTER TABLE pending_changes ADD COLUMN metadata TEXT")
    await db.execute(
        """CREATE TABLE IF NOT EXISTS questionnaires (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            session_id TEXT NOT NULL,
            questions TEXT NOT NULL,
            answers TEXT DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'active',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )"""
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_q_project_session_status ON questionnaires(project_id, session_id, status, updated_at)"
    )
    await db.execute(
        """CREATE TABLE IF NOT EXISTS external_skills (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            version TEXT NOT NULL,
            description TEXT NOT NULL,
            author TEXT,
            entry TEXT NOT NULL,
            permissions TEXT NOT NULL DEFAULT '[]',
            keywords TEXT NOT NULL DEFAULT '[]',
            min_app_version TEXT,
            source_type TEXT NOT NULL,
            source_url TEXT,
            install_path TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )"""
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_external_skills_enabled ON external_skills(enabled, updated_at)"
    )


@asynccontextmanager
async def get_project_db(project_id: str):
    db = await get_db(project_id)
    try:
        yield db
    finally:
        await db.close()


async def init_db(project_id: str | None = None):
    db = await get_db(project_id)
    schema_path = Path(__file__).parent / "schema.sql"
    schema = schema_path.read_text(encoding="utf-8")
    await db.executescript(schema)
    await _run_lightweight_migrations(db)
    await db.commit()
    await db.close()
