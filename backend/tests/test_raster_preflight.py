from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import box

import app.services.raster_preflight as rp
from app.services.raster_preflight import (
    analyze_raster,
    analyze_raster_metadata,
    build_pair_metadata,
    build_pair_preflight,
    build_pair_preflight_fast_safe,
    resolution_warning,
)


def _write_rgb_tif(
    path: Path,
    *,
    bands: int,
    pixel_size: float,
    valid_window: tuple[int, int, int, int],
    background_rgb: tuple[int, int, int] = (0, 0, 0),
) -> None:
    width = 12
    height = 10
    data = np.zeros((bands, height, width), dtype=np.uint8)
    row_start, row_stop, col_start, col_stop = valid_window
    if bands >= 4:
        data[3, row_start:row_stop, col_start:col_stop] = 255
    else:
        data[0:3, :, :] = np.asarray(background_rgb, dtype=np.uint8)[
            :, np.newaxis, np.newaxis
        ]
        data[0:3, row_start:row_stop, col_start:col_stop] = 40

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


def test_analyze_raster_extracts_inferred_black_nodata_footprint(tmp_path: Path) -> None:
    path = tmp_path / "rgb.tif"
    _write_rgb_tif(path, bands=3, pixel_size=1.0, valid_window=(2, 8, 3, 9))

    result = analyze_raster(path, chunk_size=4)

    assert result.band_count == 3
    assert result.footprint_method == "rgb_inferred_nodata_0_0_0_tol_3_sieve_16"
    assert result.valid_pixel_count == 36
    minx, miny, maxx, maxy = result.footprint_5186.bounds
    assert minx == pytest.approx(200_003)
    assert maxx == pytest.approx(200_009)
    assert miny == pytest.approx(499_992)
    assert maxy == pytest.approx(499_998)
    assert result.mean_gsd_m == pytest.approx(1.0, rel=0.02)


def test_analyze_raster_fills_tiny_near_white_nodata_holes(tmp_path: Path) -> None:
    path = tmp_path / "rgb-white-hole.tif"
    _write_rgb_tif(
        path,
        bands=3,
        pixel_size=1.0,
        valid_window=(1, 9, 1, 11),
        background_rgb=(255, 255, 255),
    )
    with rasterio.open(path, "r+") as dst:
        data = dst.read()
        data[:, 5, 5] = np.asarray([255, 253, 255], dtype=np.uint8)
        dst.write(data)

    result = analyze_raster(
        path,
        chunk_size=12,
        rgb_nodata_tolerance=3,
        rgb_nodata_sieve_pixels=16,
    )

    assert result.footprint_method == "rgb_inferred_nodata_255_255_255_tol_3_sieve_16"
    assert result.valid_pixel_count == 80
    assert result.footprint_5186.geom_type == "Polygon"
    assert len(result.footprint_5186.interiors) == 0


def test_analyze_raster_keeps_black_pixels_when_no_rgb_nodata_is_inferred(
    tmp_path: Path,
) -> None:
    path = tmp_path / "rgb-no-nodata.tif"
    _write_rgb_tif(
        path,
        bands=3,
        pixel_size=1.0,
        valid_window=(0, 10, 0, 12),
        background_rgb=(40, 40, 40),
    )
    with rasterio.open(path, "r+") as dst:
        data = dst.read()
        data[:, 5, 5] = 0
        dst.write(data)

    result = analyze_raster(path, chunk_size=12)

    assert result.footprint_method == "rgb_no_nodata_bounds"
    assert result.valid_pixel_count == 120
    assert result.footprint_5186.bounds == pytest.approx(
        (200_000, 499_990, 200_012, 500_000)
    )


def test_analyze_raster_uses_fourth_band_in_validity(tmp_path: Path) -> None:
    path = tmp_path / "rgba.tif"
    _write_rgb_tif(path, bands=4, pixel_size=0.12, valid_window=(1, 4, 2, 7))

    result = analyze_raster(path, chunk_size=3)

    assert result.band_count == 4
    assert result.footprint_method == "first_4_bands_nonzero"
    assert result.valid_pixel_count == 15
    minx, miny, maxx, maxy = result.footprint_5186.bounds
    assert minx == pytest.approx(200_000.24)
    assert maxx == pytest.approx(200_000.84)
    assert miny == pytest.approx(499_999.52)
    assert maxy == pytest.approx(499_999.88)


def test_analyze_raster_reports_progress_events(tmp_path: Path) -> None:
    path = tmp_path / "rgb.tif"
    _write_rgb_tif(path, bands=3, pixel_size=1.0, valid_window=(2, 8, 3, 9))
    events: list[dict] = []

    result = analyze_raster(
        path,
        chunk_size=4,
        progress_callback=events.append,
        progress_label="테스트",
        progress_interval_s=0,
    )

    phases = [event["phase"] for event in events]
    assert result.valid_pixel_count == 36
    assert "scan" in phases
    assert "polygonize" in phases
    assert "union" in phases
    assert "done" in phases
    assert all(event["label"] == "테스트" for event in events)


def test_analyze_raster_uses_exact_cache(tmp_path: Path) -> None:
    path = tmp_path / "rgb.tif"
    cache_dir = tmp_path / "cache"
    _write_rgb_tif(path, bands=3, pixel_size=1.0, valid_window=(2, 8, 3, 9))

    first_events: list[dict] = []
    first = analyze_raster(
        path,
        chunk_size=4,
        cache_dir=cache_dir,
        progress_callback=first_events.append,
        progress_interval_s=0,
    )
    second_events: list[dict] = []
    second = analyze_raster(
        path,
        chunk_size=4,
        cache_dir=cache_dir,
        progress_callback=second_events.append,
        progress_interval_s=0,
    )

    assert first.valid_pixel_count == second.valid_pixel_count
    assert first.footprint_5186.equals_exact(second.footprint_5186, 0.0)
    assert any(event["phase"] == "cache_write" for event in first_events)
    assert [event["phase"] for event in second_events] == ["cache_hit"]


def test_analyze_raster_metadata_does_not_scan_valid_pixels(tmp_path: Path) -> None:
    path = tmp_path / "rgb.tif"
    _write_rgb_tif(path, bands=3, pixel_size=1.0, valid_window=(2, 8, 3, 9))

    result = analyze_raster_metadata(path)

    assert result.footprint_method == "bounds"
    assert result.valid_pixel_count == 0
    assert result.width == 12
    assert result.height == 10
    minx, miny, maxx, maxy = result.footprint_5186.bounds
    assert minx == pytest.approx(200_000)
    assert maxx == pytest.approx(200_012)
    assert miny == pytest.approx(499_990)
    assert maxy == pytest.approx(500_000)


def test_resolution_warning_thresholds() -> None:
    assert resolution_warning("과년도", 0.12) is None

    warning = resolution_warning("과년도", 0.14)
    assert warning is not None
    assert warning.severity == "warning"
    assert "과년도 영상 해상도" in warning.message
    assert "권장 해상도" in warning.message
    assert "학습 기준" not in warning.message
    assert "0.14 m" in warning.message
    assert "0.12 m" in warning.message

    strong = resolution_warning("과년도", 0.16)
    assert strong is not None
    assert strong.severity == "strong"


def test_build_pair_preflight_intersects_footprints_and_collects_warnings(tmp_path: Path) -> None:
    t1 = tmp_path / "t1.tif"
    t2 = tmp_path / "t2.tif"
    _write_rgb_tif(t1, bands=3, pixel_size=0.12, valid_window=(1, 8, 1, 9))
    _write_rgb_tif(t2, bands=3, pixel_size=0.16, valid_window=(2, 7, 2, 10))

    result = build_pair_preflight(t1, t2, chunk_size=4)

    assert result.intersection_area_m2 > 0
    assert result.overlap_ratio > 0
    assert result.overlap_method == "actual_footprint"
    warning_codes = {warning.code for warning in result.warnings}
    assert "FOOTPRINT_RGB_INFERRED_NODATA" in warning_codes
    resolution_warnings = [
        warning
        for warning in result.warnings
        if warning.code == "RESOLUTION_DIFFERS_FROM_TRAINING_GSD"
    ]
    assert resolution_warnings
    assert any(warning.severity == "strong" for warning in resolution_warnings)


def test_build_pair_preflight_fast_safe_uses_bounds_and_pixel_mask_rule(
    tmp_path: Path,
) -> None:
    t1 = tmp_path / "t1.tif"
    t2 = tmp_path / "t2.tif"
    _write_rgb_tif(
        t1,
        bands=3,
        pixel_size=1.0,
        valid_window=(2, 8, 3, 9),
        background_rgb=(255, 255, 255),
    )
    _write_rgb_tif(
        t2,
        bands=3,
        pixel_size=1.0,
        valid_window=(1, 9, 2, 10),
        background_rgb=(255, 255, 255),
    )

    result = build_pair_preflight_fast_safe(t1, t2)

    assert result.overlap_method == "fast_safe_bounds_pixel_mask"
    assert result.standard.footprint_method == (
        "fast_bounds_pixel_mask_inferred_edge_255_255_255_tol_3"
    )
    assert result.standard.rgb_nodata_color == (255, 255, 255)
    assert result.standard.rgb_nodata_tolerance == 3
    assert result.intersection_5186.bounds == pytest.approx(
        (200_000, 499_990, 200_012, 500_000)
    )


def test_build_pair_preflight_exact_falls_back_for_complex_geometry(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    t1 = tmp_path / "t1.tif"
    t2 = tmp_path / "t2.tif"
    _write_rgb_tif(t1, bands=3, pixel_size=1.0, valid_window=(2, 8, 3, 9))
    _write_rgb_tif(t2, bands=3, pixel_size=1.0, valid_window=(1, 9, 2, 10))
    monkeypatch.setattr(rp, "MAX_EXACT_PAIR_GEOMETRY_WKB_BYTES", 1)

    result = build_pair_preflight(t1, t2, chunk_size=4)

    assert result.standard.footprint_method.endswith("_bounds_fallback")
    assert result.compare.footprint_method.endswith("_bounds_fallback")
    assert {
        warning.code for warning in result.warnings
    } >= {"FOOTPRINT_GEOMETRY_COMPLEXITY_FALLBACK"}


def test_build_pair_preflight_reports_resolution_warning_for_each_mismatched_input(
    tmp_path: Path,
) -> None:
    t1 = tmp_path / "t1.tif"
    t2 = tmp_path / "t2.tif"
    _write_rgb_tif(t1, bands=4, pixel_size=0.20, valid_window=(1, 8, 1, 9))
    _write_rgb_tif(t2, bands=4, pixel_size=0.16, valid_window=(2, 7, 2, 10))

    result = build_pair_preflight(t1, t2, chunk_size=4)

    messages = [
        warning.message
        for warning in result.warnings
        if warning.code == "RESOLUTION_DIFFERS_FROM_TRAINING_GSD"
    ]
    assert len(messages) == 2
    assert any("과년도 영상 해상도" in message for message in messages)
    assert any("당해년도 영상 해상도" in message for message in messages)
    assert all("권장 해상도" in message for message in messages)
    assert all("학습 기준" not in message for message in messages)


def test_build_pair_preflight_can_scope_footprint_to_target_geometry(tmp_path: Path) -> None:
    t1 = tmp_path / "t1.tif"
    t2 = tmp_path / "t2.tif"
    _write_rgb_tif(t1, bands=3, pixel_size=1.0, valid_window=(0, 10, 0, 12))
    _write_rgb_tif(t2, bands=3, pixel_size=1.0, valid_window=(0, 10, 0, 12))
    target = box(200_000, 499_990, 200_006, 500_000)

    result = build_pair_preflight(t1, t2, chunk_size=4, clip_geometry_5186=target)

    assert result.intersection_5186.bounds == pytest.approx(target.bounds)
    assert result.intersection_area_m2 == pytest.approx(target.area)


def test_build_pair_metadata_uses_bounds_for_fast_overlap(tmp_path: Path) -> None:
    t1 = tmp_path / "t1.tif"
    t2 = tmp_path / "t2.tif"
    _write_rgb_tif(t1, bands=3, pixel_size=0.12, valid_window=(1, 8, 1, 9))
    _write_rgb_tif(t2, bands=3, pixel_size=0.16, valid_window=(2, 7, 2, 10))

    result = build_pair_metadata(t1, t2)

    assert result.intersection_area_m2 > 0
    assert result.overlap_ratio > 0
    assert result.overlap_method == "bounds"
    assert result.standard.footprint_method == "bounds"
