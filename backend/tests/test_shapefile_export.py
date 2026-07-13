"""UTF-8 Shapefile 내보내기 회귀 테스트."""

from __future__ import annotations

import io
import zipfile
from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi.testclient import TestClient
from shapely import wkb
from shapely.geometry import Polygon

from app.api import exports as exports_module
from app.database import get_db
from app.main import app
from app.services.task_shapefile_export import build_shapefile_zip


def _detection(**overrides):
    values = {
        "id": "det_한글_001",
        "sheet_code": "NJ52-09-01",
        "task_id": "task_test",
        "model": "building",
        "change_type": "building_new",
        "confidence": 0.9876,
        "area_m2": 123.4567,
        "geometry": wkb.dumps(Polygon([
            (200000, 500000),
            (200010, 500000),
            (200010, 500010),
            (200000, 500010),
        ])),
        "region_code": "수도권북부",
        "address": "서울특별시 중구 세종대로 110",
        "reviewer_memo": "현장 검수 완료 — 신규 건물 확인",
        "is_deleted": False,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_shapefile_zip_roundtrips_korean_as_utf8(tmp_path):
    content, count = build_shapefile_zip(
        [_detection()],
        "nbm_task_test_detections",
    )

    assert count == 1
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        names = set(archive.namelist())
        assert names == {
            "nbm_task_test_detections.shp",
            "nbm_task_test_detections.shx",
            "nbm_task_test_detections.dbf",
            "nbm_task_test_detections.prj",
            "nbm_task_test_detections.cpg",
        }
        assert archive.read("nbm_task_test_detections.cpg") == b"UTF-8"
        dbf_bytes = archive.read("nbm_task_test_detections.dbf")
        assert "건물".encode("utf-8") in dbf_bytes
        assert "서울특별시 중구 세종대로 110".encode("utf-8") in dbf_bytes
        archive.extractall(tmp_path)

    import fiona

    with fiona.open(
        tmp_path / "nbm_task_test_detections.shp",
        encoding="UTF-8",
    ) as source:
        assert source.crs.to_epsg() == 5186
        feature = next(iter(source))
        properties = dict(feature["properties"])

    assert properties["CLASS"] == "건물"
    assert properties["TYPE_KO"] == "신축"
    assert properties["REGION"] == "수도권북부"
    assert properties["ADDR"] == "서울특별시 중구 세종대로 110"
    assert properties["MEMO"] == "현장 검수 완료 — 신규 건물 확인"
    assert properties["OBJ_ID"] == "det_한글_001"


def test_shapefile_utf8_truncation_does_not_split_korean_character(tmp_path):
    content, count = build_shapefile_zip(
        [_detection(address="가" * 100)],
        "nbm_long_text",
    )
    assert count == 1

    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        archive.extractall(tmp_path)

    import fiona

    with fiona.open(tmp_path / "nbm_long_text.shp", encoding="UTF-8") as source:
        address = dict(next(iter(source))["properties"])["ADDR"]

    assert address == "가" * 84
    assert len(address.encode("utf-8")) == 252


def test_shapefile_endpoint_returns_zip(monkeypatch):
    class FakeSession:
        def get(self, _model, _key):
            return SimpleNamespace(
                id="task_test",
                name="한글 프로젝트",
                created_at=datetime(2026, 7, 13, 5, 25, 30, tzinfo=timezone.utc),
            )

    def override_db():
        yield FakeSession()

    app.dependency_overrides[get_db] = override_db
    monkeypatch.setattr(
        exports_module,
        "create_task_shapefile_zip",
        lambda _db, _task_id, _layer_name: (b"PK\x03\x04TEST", 3),
    )
    try:
        response = TestClient(app).get("/api/v1/tasks/task_test/export/shp")
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["x-feature-count"] == "3"
    assert 'filename="20260713_142530.zip"' in response.headers["content-disposition"]
    assert response.content == b"PK\x03\x04TEST"
