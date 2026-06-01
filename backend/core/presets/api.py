from fastapi import APIRouter, HTTPException

from core.presets.definitions import GENRE_PRESETS

router = APIRouter()


@router.get("/")
async def list_presets():
    return [
        {
            "id": p["id"],
            "name": p["name"],
            "skills": p["skills"],
            "extra_folders": p["extra_folders"],
        }
        for p in GENRE_PRESETS.values()
    ]


@router.get("/{preset_id}")
async def get_preset(preset_id: str):
    preset = GENRE_PRESETS.get(preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    return preset
