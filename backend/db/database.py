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
        await db.commit()
        _initialized_dbs.add(db_key)

    return db


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
    await db.commit()
    await db.close()
