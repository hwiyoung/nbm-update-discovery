from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin

from app.database import get_db
from app.main import app


def _write_tif(
    path: Path,
    *,
    bands: int = 3,
    pixel_size: float = 0.12,
) -> None:
    width = 10
    height = 8
    data = np.zeros((bands, height, width), dtype=np.uint8)
    data[:3, 1:7, 2:9] = 60
    if bands >= 4:
        data[3, 1:7, 2:9] = 255

    transform = from_origin(200_000, 500_000, pixel_size, pixel_size)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=height,
        width=width,
        count=bands,
        dtype="uint8",
        crs="EPSG:5186",
        transform=transform,
    ) as dst:
        dst.write(data)


def _bbox(min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [[
            [min_lon, min_lat],
            [max_lon, min_lat],
            [max_lon, max_lat],
            [min_lon, max_lat],
            [min_lon, min_lat],
        ]],
    }


def _dataset(
    dataset_id: int,
    tile_path: str | None,
    *,
    bbox: dict | None = None,
) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=dataset_id,
        source="upload",
        display_name=f"Dataset {dataset_id}",
        platform="drone",
        taken_start_at=now,
        taken_end_at=now,
        bbox=bbox,
        tile_path=tile_path,
        sheet_codes=[],
        status="ready",
        thumbnail_url=None,
        size_bytes=None,
    )


def _client_with_datasets(rows: dict[int, SimpleNamespace]):
    class _FakeSession:
        def get(self, _model, key):
            return rows.get(int(key))

    def _dep():
        yield _FakeSession()

    app.dependency_overrides[get_db] = _dep
    return TestClient(app)


def test_dataset_preflight_endpoint_returns_pair_summary(tmp_path: Path) -> None:
    t1 = tmp_path / "t1.tif"
    t2 = tmp_path / "t2.tif"
    _write_tif(t1, bands=3, pixel_size=0.12)
    _write_tif(t2, bands=4, pixel_size=0.16)

    client = _client_with_datasets({
        1: _dataset(1, str(t1)),
        2: _dataset(2, str(t2)),
    })
    try:
        response = client.get("/api/v1/datasets/preflight?std=1&cmp=2")
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 200
    body = response.json()
    assert body["standard"]["dataset_id"] == 1
    assert body["compare"]["dataset_id"] == 2
    assert body["standard"]["footprint_method"] == (
        "fast_bounds_pixel_mask_inferred_edge_0_0_0_tol_3"
    )
    assert body["compare"]["footprint_method"] == "fast_bounds_pixel_mask_alpha"
    assert body["target_gsd_m"] == 0.12
    assert body["intersection_area_m2"] > 0
    assert body["overlap_ratio"] > 0
    assert body["overlap_method"] == "fast_safe_bounds_pixel_mask"
    assert body["can_proceed"] is True
    warning_codes = {warning["code"] for warning in body["warnings"]}
    assert "FOOTPRINT_FAST_BOUNDS_PIXEL_MASK" in warning_codes
    assert "RESOLUTION_DIFFERS_FROM_TRAINING_GSD" in warning_codes


def test_dataset_preflight_metadata_endpoint_is_bounds_based(tmp_path: Path) -> None:
    t1 = tmp_path / "t1.tif"
    t2 = tmp_path / "t2.tif"
    _write_tif(t1, bands=3, pixel_size=0.12)
    _write_tif(t2, bands=4, pixel_size=0.16)

    client = _client_with_datasets({
        1: _dataset(1, str(t1)),
        2: _dataset(2, str(t2)),
    })
    try:
        response = client.get("/api/v1/datasets/preflight/metadata?std=1&cmp=2")
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 200
    body = response.json()
    assert body["standard"]["footprint_method"] == "bounds"
    assert body["compare"]["footprint_method"] == "bounds"
    assert body["standard"]["valid_pixel_count"] == 0
    assert body["overlap_method"] == "bounds"
    assert body["overlap_ratio"] > 0


def test_dataset_preflight_endpoint_requires_tile_paths() -> None:
    client = _client_with_datasets({
        1: _dataset(1, None),
        2: _dataset(2, "/tmp/compare.tif"),
    })
    try:
        response = client.get("/api/v1/datasets/preflight?std=1&cmp=2")
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 400
    assert response.json()["detail"]["error"]["code"] == "BUSINESS_RULE_VIOLATION"


def test_dataset_preflight_metadata_falls_back_to_dataset_bbox() -> None:
    client = _client_with_datasets({
        1: _dataset(1, None, bbox=_bbox(126.90, 37.40, 126.92, 37.42)),
        2: _dataset(2, None, bbox=_bbox(126.91, 37.41, 126.93, 37.43)),
    })
    try:
        response = client.get("/api/v1/datasets/preflight/metadata?std=1&cmp=2")
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 200
    body = response.json()
    assert body["standard"]["footprint_method"] == "dataset_bbox"
    assert body["compare"]["footprint_method"] == "dataset_bbox"
    assert body["overlap_method"] == "dataset_bbox"
    assert body["intersection_area_m2"] > 0
    assert body["overlap_ratio"] > 0
    warning_codes = {warning["code"] for warning in body["warnings"]}
    assert "METADATA_BBOX_FALLBACK" in warning_codes
