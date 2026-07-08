from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import Polygon, box

from app.services.raster_preflight import PairPreflight, RasterPreflight
from app.services.sheet_chip_manifest import build_sheet_chip_manifest
from app.services.sheet_chip_writer import (
    filter_manifest_by_common_valid_data,
    write_sheet_chips,
)


def _write_source(path: Path, *, pixel_size: float, value: int) -> None:
    width = 12
    height = 12
    data = np.full((3, height, width), value, dtype=np.uint8)
    _write_source_data(path, pixel_size=pixel_size, data=data)


def _write_source_data(path: Path, *, pixel_size: float, data: np.ndarray) -> None:
    _, height, width = data.shape
    transform = from_origin(0, 12, pixel_size, pixel_size)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=height,
        width=width,
        count=3,
        dtype="uint8",
        crs="EPSG:5186",
        transform=transform,
    ) as dst:
        dst.write(data)


def _pair(
    t1: Path,
    t2: Path,
    intersection,
    *,
    rgb_nodata_color: tuple[int, int, int] | None = None,
    rgb_nodata_tolerance: int | None = None,
):
    def raster(path: Path) -> RasterPreflight:
        return RasterPreflight(
            path=str(path),
            crs="EPSG:5186",
            width=12,
            height=12,
            band_count=3,
            gsd_x_m=1.0,
            gsd_y_m=1.0,
            footprint_5186=intersection,
            footprint_method="fast_bounds_pixel_mask",
            valid_pixel_count=144,
            rgb_nodata_color=rgb_nodata_color,
            rgb_nodata_tolerance=rgb_nodata_tolerance,
        )

    return PairPreflight(
        standard=raster(t1),
        compare=raster(t2),
        intersection_5186=intersection,
        target_gsd_m=1.0,
        warnings=[],
    )


def test_write_sheet_chips_outputs_masked_t1_t2_pairs(tmp_path: Path) -> None:
    t1 = tmp_path / "t1.tif"
    t2 = tmp_path / "t2.tif"
    _write_source(t1, pixel_size=1.0, value=50)
    _write_source(t2, pixel_size=1.0, value=90)

    pair = _pair(t1, t2, box(0, 0, 10, 10))
    triangle = Polygon([(0, 0), (10, 0), (0, 10)])
    manifest = build_sheet_chip_manifest(
        pair,
        [SimpleNamespace(code="SHEET001", geometry=triangle)],
        buffer_m=0,
        target_gsd_m=1.0,
    )

    written = write_sheet_chips(pair, manifest, tmp_path / "chips")

    assert len(written) == 1
    assert written[0].sheet_code == "SHEET001"
    assert written[0].valid_mask_path.exists()
    with rasterio.open(written[0].t1_path) as src:
        assert src.crs.to_string() == "EPSG:5186"
        assert src.width == 10
        assert src.height == 10
        assert src.count == 3
        assert src.res == pytest.approx((1.0, 1.0))
        arr = src.read(1)
    assert arr.max() == 50
    assert arr.min() == 0
    assert np.count_nonzero(arr == 50) > 0
    assert np.count_nonzero(arr == 0) > 0

    with rasterio.open(written[0].t2_path) as src:
        arr = src.read(1)
    assert arr.max() == 90
    assert arr.min() == 0
    with rasterio.open(written[0].valid_mask_path) as src:
        mask = src.read(1)
    assert mask.max() == 1
    assert mask.min() == 0


def test_write_sheet_chips_resamples_to_manifest_grid(tmp_path: Path) -> None:
    t1 = tmp_path / "t1.tif"
    t2 = tmp_path / "t2.tif"
    _write_source(t1, pixel_size=1.0, value=30)
    _write_source(t2, pixel_size=2.0, value=70)

    pair = _pair(t1, t2, box(0, 0, 6, 6))
    manifest = build_sheet_chip_manifest(
        pair,
        [SimpleNamespace(code="SHEET001", geometry=box(0, 0, 6, 6))],
        buffer_m=0,
        target_gsd_m=0.5,
    )

    written = write_sheet_chips(pair, manifest, tmp_path / "chips", resampling="bicubic")

    assert len(written) == 1
    with rasterio.open(written[0].t1_path) as src:
        assert src.width == 12
        assert src.height == 12
        assert src.res == pytest.approx((0.5, 0.5))
        assert int(src.read(1).max()) == 30
    with rasterio.open(written[0].t2_path) as src:
        assert src.width == 12
        assert src.height == 12
        assert src.res == pytest.approx((0.5, 0.5))
        assert int(src.read(1).max()) == 70


def test_write_sheet_chips_masks_inferred_white_nodata_pixels(tmp_path: Path) -> None:
    t1 = tmp_path / "t1.tif"
    t2 = tmp_path / "t2.tif"
    data1 = np.full((3, 12, 12), 255, dtype=np.uint8)
    data2 = np.full((3, 12, 12), 255, dtype=np.uint8)
    data1[:, 3:9, 3:9] = 50
    data2[:, 3:9, 3:9] = 90
    data1[:, 1, 1] = np.asarray([255, 253, 255], dtype=np.uint8)
    data2[:, 1, 1] = np.asarray([255, 253, 255], dtype=np.uint8)
    _write_source_data(t1, pixel_size=1.0, data=data1)
    _write_source_data(t2, pixel_size=1.0, data=data2)

    pair = _pair(
        t1,
        t2,
        box(0, 0, 12, 12),
        rgb_nodata_color=(255, 255, 255),
        rgb_nodata_tolerance=3,
    )
    manifest = build_sheet_chip_manifest(
        pair,
        [SimpleNamespace(code="SHEET001", geometry=box(0, 0, 12, 12))],
        buffer_m=0,
        target_gsd_m=1.0,
    )

    written = write_sheet_chips(pair, manifest, tmp_path / "chips")

    assert len(written) == 1
    assert written[0].t1_valid_pixel_count == 36
    assert written[0].t2_valid_pixel_count == 36
    assert written[0].common_valid_pixel_count == 36
    with rasterio.open(written[0].t1_path) as src:
        arr = src.read(1)
    assert arr[4, 4] == 50
    assert arr[1, 1] == 0
    assert arr[0, 0] == 0
    with rasterio.open(written[0].valid_mask_path) as src:
        mask = src.read(1)
    assert mask[4, 4] == 1
    assert mask[1, 1] == 0
    assert mask[0, 0] == 0


def test_write_sheet_chips_skips_empty_after_nodata_mask(tmp_path: Path) -> None:
    t1 = tmp_path / "t1.tif"
    t2 = tmp_path / "t2.tif"
    _write_source_data(
        t1,
        pixel_size=1.0,
        data=np.full((3, 12, 12), 255, dtype=np.uint8),
    )
    _write_source(t2, pixel_size=1.0, value=90)

    pair = _pair(
        t1,
        t2,
        box(0, 0, 12, 12),
        rgb_nodata_color=(255, 255, 255),
        rgb_nodata_tolerance=3,
    )
    manifest = build_sheet_chip_manifest(
        pair,
        [SimpleNamespace(code="SHEET001", geometry=box(0, 0, 12, 12))],
        buffer_m=0,
        target_gsd_m=1.0,
    )

    written = write_sheet_chips(pair, manifest, tmp_path / "chips")

    assert written == []
    assert not (tmp_path / "chips" / "T1" / "SHEET001.tif").exists()
    assert not (tmp_path / "chips" / "T2" / "SHEET001.tif").exists()
    assert not (tmp_path / "chips" / "_valid_masks" / "SHEET001.tif").exists()


def test_filter_manifest_by_common_valid_data_skips_all_nodata_sheet(
    tmp_path: Path,
) -> None:
    t1 = tmp_path / "t1.tif"
    t2 = tmp_path / "t2.tif"
    data1 = np.full((3, 12, 12), 255, dtype=np.uint8)
    data2 = np.full((3, 12, 12), 255, dtype=np.uint8)
    data1[:, :, :6] = 50
    data2[:, :, :6] = 90
    _write_source_data(t1, pixel_size=1.0, data=data1)
    _write_source_data(t2, pixel_size=1.0, data=data2)

    pair = _pair(
        t1,
        t2,
        box(0, 0, 12, 12),
        rgb_nodata_color=(255, 255, 255),
        rgb_nodata_tolerance=3,
    )
    manifest = build_sheet_chip_manifest(
        pair,
        [
            SimpleNamespace(code="VALID001", geometry=box(0, 0, 6, 12)),
            SimpleNamespace(code="EMPTY001", geometry=box(6, 0, 12, 12)),
        ],
        buffer_m=0,
        target_gsd_m=1.0,
    )

    filtered = filter_manifest_by_common_valid_data(
        pair,
        manifest,
        max_sample_pixels=144,
        min_valid_ratio=0.0,
    )

    assert [chip.sheet_code for chip in filtered.chips] == ["VALID001"]
    assert [
        (item.sheet_code, item.reason)
        for item in filtered.skipped_sheets
    ] == [("EMPTY001", "no_common_valid_pixels_prefilter")]
