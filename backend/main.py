from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

from app_version import APP_NAME, APP_VERSION, version_payload
from config import settings
from api import projects, files, agent, memory, timeline, settings as settings_api, skills, foreshadowing, characters, soul
from api import entity_versions, plans, plan_notes
from core.skills.definitions import register_all_skills
from core.presets import api as presets_api


@asynccontextmanager
async def lifespan(app: FastAPI):
    from api.settings import load_settings
    load_settings()
    register_all_skills()
    yield


app = FastAPI(title=APP_NAME, version=APP_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(agent.router, prefix="/api/agent", tags=["agent"])
app.include_router(memory.router, prefix="/api/memory", tags=["memory"])
app.include_router(timeline.router, prefix="/api/timeline", tags=["timeline"])
app.include_router(settings_api.router, prefix="/api/settings", tags=["settings"])
app.include_router(skills.router, prefix="/api/skills", tags=["skills"])
app.include_router(foreshadowing.router, prefix="/api/foreshadowing", tags=["foreshadowing"])
app.include_router(characters.router, prefix="/api/characters", tags=["characters"])
app.include_router(soul.router, prefix="/api/soul", tags=["soul"])
app.include_router(presets_api.router, prefix="/api/presets", tags=["presets"])
app.include_router(entity_versions.router)
app.include_router(plans.router)
app.include_router(plan_notes.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/version")
async def version():
    return version_payload()


# Serve frontend static files in production (with SPA fallback)
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    _static_app = StaticFiles(directory=str(frontend_dist), html=True)
    _index_html = str(frontend_dist / "index.html")

    @app.middleware("http")
    async def spa_fallback(request: Request, call_next):
        response = await call_next(request)
        # Only fall back for non-API GET requests that result in 404
        if response.status_code == 404 and request.method == "GET" and not request.url.path.startswith("/api"):
            file_path = frontend_dist / request.url.path.lstrip("/")
            if not file_path.exists() or file_path.is_dir():
                return FileResponse(_index_html)
        return response

    app.mount("/", _static_app, name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=True)
