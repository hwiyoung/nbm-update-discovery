"""3D DXF Export 엔드포인트 통합 테스트.

DB 연결 없이 dependency override + monkeypatch 로 단위 동작을 검증한다:
  - 503: DEM service 미초기화
  - 404: task 미존재
  - 400: detection 0건
  - 422: MissingDEMError (DEM 미비)
  - 200: 정상 (실 service + 실 GPKG)
  - 다운로드 GET: 정상 파일 반환 + 경로 차단
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api import exports as exports_module
from app.config import get_settings
from app.database import get_db
from app.main import app
from app.services import dem_z_registry
from app.services.dem_z_export import (
    DEMZExportService,
    ExportResult,
    MissingDEMError,
)


# ============================================================
# Fixtures — DB / Task 대체
# ============================================================


def _fake_db():
    class _FakeSession:
        def __init__(self, task):
            self._task = task

        def get(self, model, key):
            return self._task

        def execute(self, *_a, **_kw):
            class _R:
                def scalars(self_inner):
                    class _S:
                        def all(self_innermost):
                            return []
                    return _S()
            return _R()

    def _dep_factory(task):
        def _dep():
            yield _FakeSession(task)
        return _dep
    return _dep_factory


@pytest.fixture
def client_with_fake_db():
    """task=valid 인 FakeSession 으로 get_db 오버라이드."""
    fake_task = SimpleNamespace(id="task_test", name="Test Task")
    factory = _fake_db()
    app.dependency_overrides[get_db] = factory(fake_task)
    yield TestClient(app), fake_task
    app.dependency_overrides.pop(get_db, None)


# ============================================================
# 503: service 미초기화
# ============================================================


def test_503_when_service_not_initialized(monkeypatch, client_with_fake_db):
    client, _ = client_with_fake_db
    monkeypatch.setattr(dem_z_registry, "_service", None)
    monkeypatch.setattr(
        dem_z_registry, "_init_error",
        "sheet index 파일 없음: /data/seed/missing.geojson",
    )

    resp = client.post(
        "/api/v1/tasks/task_test/export/dxf-3d",
        json={"layer_name": "VARIATION"},
    )
    assert resp.status_code == 503
    body = resp.json()
    assert body["error"] == "dem_service_unavailable"
    assert "sheet index" in body["detail"]


# ============================================================
# 404: task 미존재
# ============================================================


def test_404_when_task_missing(monkeypatch):
    factory = _fake_db()
    app.dependency_overrides[get_db] = factory(None)  # get() returns None
    try:
        # service 는 있는 척 — DEMZExportService 인스턴스가 굳이 필요 없으므로 더미
        monkeypatch.setattr(dem_z_registry, "_service", SimpleNamespace())
        client = TestClient(app)
        resp = client.post(
            "/api/v1/tasks/nope/export/dxf-3d",
            json={"layer_name": "X"},
        )
        assert resp.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)


# ============================================================
# 400: detection 0건
# ============================================================


def test_400_when_no_detections(monkeypatch, client_with_fake_db):
    client, _ = client_with_fake_db
    monkeypatch.setattr(dem_z_registry, "_service", SimpleNamespace())

    # write_task_detections_gpkg 가 0 을 반환하도록 강제
    monkeypatch.setattr(
        exports_module, "write_task_detections_gpkg",
        lambda db, task_id, dest_dir=None, object_ids=None: (Path(""), 0),
    )

    resp = client.post(
        "/api/v1/tasks/task_test/export/dxf-3d",
        json={"layer_name": "X"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "no_detections"


def test_3d_export_passes_selected_object_ids(monkeypatch, client_with_fake_db):
    client, _ = client_with_fake_db
    monkeypatch.setattr(dem_z_registry, "_service", SimpleNamespace())
    captured = None

    def fake_write(db, task_id, dest_dir=None, object_ids=None):
        nonlocal captured
        captured = object_ids
        return Path(""), 0

    monkeypatch.setattr(exports_module, "write_task_detections_gpkg", fake_write)
    resp = client.post(
        "/api/v1/tasks/task_test/export/dxf-3d",
        json={"layer_name": "X", "object_ids": ["obj_1", "obj_2"]},
    )

    assert resp.status_code == 400
    assert captured == ["obj_1", "obj_2"]


# ============================================================
# 422: MissingDEMError
# ============================================================


def test_422_when_missing_dem(monkeypatch, tmp_path, client_with_fake_db):
    client, _ = client_with_fake_db

    fake_gpkg = tmp_path / "fake.gpkg"
    fake_gpkg.touch()
    monkeypatch.setattr(
        exports_module, "write_task_detections_gpkg",
        lambda db, task_id, dest_dir=None, object_ids=None: (fake_gpkg, 1),
    )

    class _FailingService:
        def export(self, **_kw):
            raise MissingDEMError("DEM tiles not found for sheets [X, Y]")

    monkeypatch.setattr(dem_z_registry, "_service", _FailingService())

    resp = client.post(
        "/api/v1/tasks/task_test/export/dxf-3d",
        json={"layer_name": "X"},
    )
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"] == "missing_dem"
    assert "DEM tiles not found" in body["detail"]


# ============================================================
# 200: 정상 — 실 DEMZExportService + 실 GPKG (conftest export_env 재사용)
# ============================================================


def test_200_happy_path_with_real_service(
    monkeypatch, tmp_path, client_with_fake_db, export_env,
):
    """conftest 의 export_env (sheet index + DEM + polygons) 로 실 service 인스턴스화."""
    client, _ = client_with_fake_db

    real_service = DEMZExportService(
        sheet_index_path=export_env["sheet_index_path"],
        dem_dir=export_env["dem_dir"],
        sheet_code_field="MAPIDCD_NO",
        target_crs="EPSG:5186",
        dem_filename_pattern="{sheet_code}.tif",
    )
    monkeypatch.setattr(dem_z_registry, "_service", real_service)

    # detection_gpkg 헬퍼는 fixture 의 polygons 를 그대로 반환
    monkeypatch.setattr(
        exports_module, "write_task_detections_gpkg",
        lambda db, task_id, dest_dir=None, object_ids=None: (export_env["polygons_path"], 2),
    )

    # 출력 디렉토리를 tmp_path 로 리다이렉트
    settings = get_settings()
    monkeypatch.setattr(
        settings,
        "change_detection_workspace_root",
        str(tmp_path / "exports"),
    )

    resp = client.post(
        "/api/v1/tasks/task_test/export/dxf-3d",
        json={"layer_name": "VARIATION"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["filename"].endswith(".dxf")
    assert body["download_url"].startswith(
        "/api/v1/tasks/task_test/export/dxf-3d/files/"
    )
    stats = body["statistics"]
    assert stats["total_objects"] == 2
    assert stats["total_vertices"] == 10
    assert stats["nodata_vertex_count"] == 0

    # 파일이 실 디스크에 작성됐고 latest 심볼링크가 생겼는지 확인
    out_dir = Path(tmp_path / "exports" / "task_test")
    assert (out_dir / body["filename"]).exists()
    latest = out_dir / "latest.dxf"
    assert latest.exists()
    # 심볼링크 — POSIX 환경에서만 검증
    if latest.is_symlink():
        assert latest.resolve().name == body["filename"]


# ============================================================
# 다운로드 GET — 정상 + 경로 traversal 차단
# ============================================================


def test_download_returns_file(monkeypatch, tmp_path):
    settings = get_settings()
    monkeypatch.setattr(
        settings,
        "change_detection_workspace_root",
        str(tmp_path / "exports"),
    )

    out_dir = Path(tmp_path / "exports" / "task_dl")
    out_dir.mkdir(parents=True)
    f = out_dir / "3d_changes_20260521_000000.dxf"
    f.write_bytes(b"DUMMY-DXF-CONTENT")

    client = TestClient(app)
    resp = client.get(
        "/api/v1/tasks/task_dl/export/dxf-3d/files/3d_changes_20260521_000000.dxf"
    )
    assert resp.status_code == 200
    assert resp.content == b"DUMMY-DXF-CONTENT"


def test_download_rejects_path_traversal(monkeypatch, tmp_path):
    settings = get_settings()
    monkeypatch.setattr(
        settings,
        "change_detection_workspace_root",
        str(tmp_path / "exports"),
    )
    client = TestClient(app)
    resp = client.get(
        "/api/v1/tasks/task_dl/export/dxf-3d/files/..%2Fetc%2Fpasswd"
    )
    # FastAPI 가 URL decoding 한 결과로 ".." 가 들어옴 → 400
    assert resp.status_code in (400, 404)


def test_download_rejects_non_dxf(monkeypatch, tmp_path):
    settings = get_settings()
    monkeypatch.setattr(
        settings,
        "change_detection_workspace_root",
        str(tmp_path / "exports"),
    )
    client = TestClient(app)
    resp = client.get(
        "/api/v1/tasks/task_dl/export/dxf-3d/files/secret.txt"
    )
    assert resp.status_code == 400
