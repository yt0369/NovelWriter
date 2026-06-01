APP_NAME = "NovelWriter"
APP_VERSION = "3.0.0"
APP_BUILD = "local"


def version_payload() -> dict[str, str]:
    return {
        "app": APP_NAME,
        "version": APP_VERSION,
        "build": APP_BUILD,
    }
