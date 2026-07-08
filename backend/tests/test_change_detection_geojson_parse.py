from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import box, mapping

from app.services.change_detection_engine import _parse_geojson


def test_parse_geojson_clips_sheet_chip_buffer_to_core(tmp_path: Path) -> None:
    output = tmp_path / "SMOKE001.json"
    output.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "crs": {
                    "type": "name",
                    "properties": {"name": "EPSG:5186"},
                },
                "features": [
                    {
                        "type": "Feature",
                        "properties": {
                            "CLS_ID": 1,
                            "CONF": 0.91,
                            "AREA": 20.0,
                        },
                        "geometry": mapping(box(4, 0, 6, 10)),
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    records = _parse_geojson(
        output,
        category="building",
        sheet_geoms=[
            ("A", box(0, 0, 5, 10)),
            ("B", box(5, 0, 10, 10)),
        ],
        clip_geometry_5186=box(0, 0, 5, 10),
    )

    assert len(records) == 1
    assert records[0].sheet_code == "A"
    assert records[0].change_type == "building_new"
    assert records[0].area_m2 == pytest.approx(10.0)
    assert "POLYGON" in records[0].geometry_wkt_5186


def test_parse_geojson_filters_records_outside_common_valid_mask(tmp_path: Path) -> None:
    output = tmp_path / "SMOKE001.json"
    output.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "crs": {
                    "type": "name",
                    "properties": {"name": "EPSG:5186"},
                },
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"CLS_ID": 1, "CONF": 0.91, "AREA": 1.0},
                        "geometry": mapping(box(1, 1, 2, 2)),
                    },
                    {
                        "type": "Feature",
                        "properties": {"CLS_ID": 1, "CONF": 0.91, "AREA": 1.0},
                        "geometry": mapping(box(7, 1, 8, 2)),
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    mask_path = tmp_path / "valid.tif"
    mask = np.zeros((10, 10), dtype=np.uint8)
    mask[:, :5] = 1
    with rasterio.open(
        mask_path,
        "w",
        driver="GTiff",
        width=10,
        height=10,
        count=1,
        dtype="uint8",
        crs="EPSG:5186",
        transform=from_origin(0, 10, 1, 1),
        nodata=0,
    ) as dst:
        dst.write(mask, 1)

    records = _parse_geojson(
        output,
        category="building",
        sheet_geoms=[("A", box(0, 0, 10, 10))],
        clip_geometry_5186=box(0, 0, 10, 10),
        valid_mask_path_5186=mask_path,
        valid_mask_min_ratio=0.5,
    )

    assert len(records) == 1
    assert records[0].sheet_code == "A"
    assert records[0].area_m2 == pytest.approx(1.0)
