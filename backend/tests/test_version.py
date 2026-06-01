import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app_version import APP_VERSION, version_payload
from main import app, version


class VersionTests(unittest.IsolatedAsyncioTestCase):
    def test_version_payload_is_v3_release(self):
        payload = version_payload()

        assert payload == {
            "app": "NovelWriter",
            "version": "3.0.0",
            "build": "local",
        }

    async def test_version_route_matches_fastapi_metadata(self):
        payload = await version()

        assert payload["version"] == APP_VERSION
        assert app.version == APP_VERSION
