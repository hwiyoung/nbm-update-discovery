from app.config import get_settings
from app.main import app, health, root


def test_app_version_is_exposed_consistently() -> None:
    expected = get_settings().app_version

    assert app.version == expected
    assert health() == {"status": "ok", "version": expected}
    assert root()["version"] == expected
