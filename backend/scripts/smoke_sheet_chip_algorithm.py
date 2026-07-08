"""Smoke test sheet-chip preparation through the real algorithm runner.

This script creates a tiny synthetic T1/T2 raster pair, prepares it through the
``sheet_12cm`` input path, runs one real change-detection algorithm, and checks
that the expected GeoJSON output is produced. It avoids DB state and large user
rasters, so it is safe to run repeatedly inside the engine worker container.
"""

from __future__ import annotations

import argparse
import json
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import box

from app.config import get_settings
from app.services.change_detection_engine import run_algorithm_category
from app.services.task_artifacts import task_artifact_dir


TARGET_CRS = "EPSG:5186"
TARGET_GSD_M = 0.12
SOURCE_ORIGIN_X = 200_000.0
SOURCE_ORIGIN_Y = 500_000.0


@dataclass(frozen=True)
class SmokeSheet:
    code: str
    geometry: bytes


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--category",
        choices=["building", "road"],
        default="building",
    )
    parser.add_argument("--workdir", default="")
    parser.add_argument("--size", type=int, default=256)
    parser.add_argument("--patch-size", type=int, default=256)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--overlap-ratio", default="0")
    parser.add_argument("--sheet-buffer-m", type=float, default=1.2)
    args = parser.parse_args()

    workdir = Path(args.workdir) if args.workdir else Path(
        tempfile.mkdtemp(prefix="nbm-sheet-chip-algorithm-smoke-")
    )
    source_dir = workdir / "source"
    source_dir.mkdir(parents=True, exist_ok=True)

    standard_path = source_dir / "t1.tif"
    compare_path = source_dir / "t2.tif"
    _write_smoke_raster(standard_path, size=args.size, variant="t1")
    _write_smoke_raster(compare_path, size=args.size, variant="t2")

    sheet = _smoke_sheet(size=args.size)

    settings = get_settings()
    settings.change_detection_engine_mode = "algorithm"
    settings.change_detection_prepare_mode = "sheet_12cm"
    settings.change_detection_workspace_root = str(workdir / "artifacts")
    settings.change_detection_target_gsd_m = TARGET_GSD_M
    settings.change_detection_sheet_buffer_m = args.sheet_buffer_m
    settings.change_detection_resampling = "cubic"
    settings.change_detection_patch_size = args.patch_size
    settings.change_detection_overlap_ratio = args.overlap_ratio
    settings.change_detection_batch_size = args.batch_size

    task_id = f"smoke_sheet_chip_{args.category}"
    records = run_algorithm_category(
        settings=settings,
        task_id=task_id,
        category=args.category,
        standard_path=str(standard_path),
        compare_path=str(compare_path),
        sheets=[sheet],
    )

    workspace = task_artifact_dir(settings, task_id) / args.category
    output_json = workspace / "output" / f"{sheet.code}.json"
    status_json = workspace / "output" / "status.json"
    summary: dict[str, Any] = {
        "category": args.category,
        "workdir": str(workdir),
        "source_size": [args.size, args.size],
        "prepared_t1": str(workspace / "input" / "T1" / f"{sheet.code}.tif"),
        "prepared_t2": str(workspace / "input" / "T2" / f"{sheet.code}.tif"),
        "output_json": str(output_json),
        "output_json_exists": output_json.exists(),
        "parsed_records": len(records),
    }
    if status_json.exists():
        summary["status"] = json.loads(status_json.read_text(encoding="utf-8"))
    if output_json.exists():
        output = json.loads(output_json.read_text(encoding="utf-8"))
        summary["output_feature_count"] = len(output.get("features", []))

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if not output_json.exists():
        raise RuntimeError(f"algorithm did not produce output json: {output_json}")
    return 0


def _write_smoke_raster(path: Path, *, size: int, variant: str) -> None:
    if size < 64:
        raise ValueError("size must be at least 64 pixels")

    yy, xx = np.indices((size, size), dtype=np.uint16)
    rgb = np.zeros((3, size, size), dtype=np.uint8)
    rgb[0] = ((xx * 3 + yy + 37) % 220 + 20).astype(np.uint8)
    rgb[1] = ((xx + yy * 2 + 71) % 220 + 20).astype(np.uint8)
    rgb[2] = ((xx * 2 + yy * 3 + 113) % 220 + 20).astype(np.uint8)

    if variant == "t2":
        start = size // 3
        stop = start + max(12, size // 8)
        change_color = np.array([230, 40, 40], dtype=np.uint8)[:, None, None]
        rgb[:, start:stop, start:stop] = change_color

    nodata_margin = max(8, size // 16)
    alpha = np.full((size, size), 255, dtype=np.uint8)
    for band in rgb:
        band[:nodata_margin, :] = 0
        band[-nodata_margin:, :] = 0
        band[:, :nodata_margin] = 0
        band[:, -nodata_margin:] = 0
    alpha[:nodata_margin, :] = 0
    alpha[-nodata_margin:, :] = 0
    alpha[:, :nodata_margin] = 0
    alpha[:, -nodata_margin:] = 0

    data = np.concatenate([rgb, alpha[None, :, :]], axis=0)
    transform = from_origin(SOURCE_ORIGIN_X, SOURCE_ORIGIN_Y, TARGET_GSD_M, TARGET_GSD_M)
    profile = {
        "driver": "GTiff",
        "height": size,
        "width": size,
        "count": 4,
        "dtype": "uint8",
        "crs": TARGET_CRS,
        "transform": transform,
        "nodata": 0,
        "tiled": True,
        "blockxsize": _tile_size(size),
        "blockysize": _tile_size(size),
        "compress": "lzw",
    }
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data)


def _smoke_sheet(*, size: int) -> SmokeSheet:
    margin_pixels = max(16, size // 8)
    left = SOURCE_ORIGIN_X + margin_pixels * TARGET_GSD_M
    right = SOURCE_ORIGIN_X + (size - margin_pixels) * TARGET_GSD_M
    top = SOURCE_ORIGIN_Y - margin_pixels * TARGET_GSD_M
    bottom = SOURCE_ORIGIN_Y - (size - margin_pixels) * TARGET_GSD_M
    return SmokeSheet(code="SMOKE001", geometry=box(left, bottom, right, top).wkb)


def _tile_size(size: int) -> int:
    return max(16, min(256, size // 16 * 16))


if __name__ == "__main__":
    raise SystemExit(main())
