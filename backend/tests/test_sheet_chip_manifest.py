from __future__ import annotations

from types import SimpleNamespace

import pytest
from shapely.geometry import box

from app.services.raster_preflight import PairPreflight, RasterPreflight
from app.services.sheet_chip_manifest import (
    build_sheet_chip_manifest,
    coerce_sheet_geometry,
)


def _raster(footprint):
    return RasterPreflight(
        path="/tmp/source.tif",
        crs="EPSG:5186",
        width=100,
        height=100,
        band_count=3,
        gsd_x_m=0.12,
        gsd_y_m=0.12,
        footprint_5186=footprint,
        footprint_method="first_3_bands_nonzero",
        valid_pixel_count=10_000,
    )


def _pair(intersection):
    raster = _raster(intersection)
    return PairPreflight(
        standard=raster,
        compare=raster,
        intersection_5186=intersection,
        target_gsd_m=0.12,
        warnings=[],
    )


def test_build_sheet_chip_manifest_buffers_and_clips_to_pair_intersection() -> None:
    pair = _pair(box(0, 0, 100, 100))
    sheets = [
        SimpleNamespace(code="A", geometry=box(0, 0, 50, 100)),
        SimpleNamespace(code="B", geometry=box(50, 0, 100, 100)),
        SimpleNamespace(code="C", geometry=box(200, 0, 300, 100)),
    ]

    manifest = build_sheet_chip_manifest(
        pair,
        sheets,
        buffer_m=10.0,
        target_gsd_m=1.0,
    )

    assert [chip.sheet_code for chip in manifest.chips] == ["A", "B"]
    assert [item.sheet_code for item in manifest.skipped_sheets] == ["C"]
    assert manifest.skipped_sheets[0].reason == "no_core_intersection"

    first = manifest.chips[0]
    assert first.core_area_m2 == pytest.approx(5_000)
    assert first.read_geometry_5186.bounds == pytest.approx((0, 0, 60, 100))
    assert first.grid.bounds_5186 == pytest.approx((0, 0, 60, 100))
    assert first.grid.width == 60
    assert first.grid.height == 100

    second = manifest.chips[1]
    assert second.read_geometry_5186.bounds == pytest.approx((40, 0, 100, 100))
    assert manifest.total_pixels == 12_000


def test_build_sheet_chip_manifest_aligns_grid_to_target_gsd() -> None:
    pair = _pair(box(0.05, 0.07, 1.01, 1.02))
    sheets = [SimpleNamespace(code="A", geometry=box(0, 0, 2, 2))]

    manifest = build_sheet_chip_manifest(
        pair,
        sheets,
        buffer_m=0,
        target_gsd_m=0.12,
        min_core_area_m2=0.001,
    )

    assert len(manifest.chips) == 1
    grid = manifest.chips[0].grid
    assert grid.bounds_5186 == pytest.approx((0.0, 0.0, 1.08, 1.08))
    assert grid.width == 9
    assert grid.height == 9


def test_build_sheet_chip_manifest_skips_all_when_pair_intersection_is_empty() -> None:
    pair = _pair(box(0, 0, 0, 0))
    sheets = [
        SimpleNamespace(code="A", geometry=box(0, 0, 1, 1)),
        SimpleNamespace(code="B", geometry=box(1, 0, 2, 1)),
    ]

    manifest = build_sheet_chip_manifest(pair, sheets)

    assert manifest.chips == []
    assert [(item.sheet_code, item.reason) for item in manifest.skipped_sheets] == [
        ("A", "empty_pair_intersection"),
        ("B", "empty_pair_intersection"),
    ]


def test_coerce_sheet_geometry_accepts_wkb_geometry() -> None:
    geom = box(0, 0, 1, 1)
    sheet = SimpleNamespace(code="A", geometry=geom.wkb)

    result = coerce_sheet_geometry(sheet)

    assert result.code == "A"
    assert result.geometry_5186.equals(geom)
