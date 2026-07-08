"""Adapter for the real road/building change-detection algorithms.

The application DB/API keeps geometry in EPSG:5186. The algorithm repositories
also emit EPSG:5186 GeoJSON for the current orthomosaic pair, so this adapter
keeps that path direct and only transforms when an output CRS says otherwise.
"""

from __future__ import annotations

import json
import math
import os
import select
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from threading import Event
from typing import Any, Callable, Iterable

import numpy as np
import rasterio
from rasterio.features import rasterize
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT
from rasterio.windows import Window, from_bounds
from shapely import wkb
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform, unary_union

from app.config import Settings
from app.models.sheet import MapSheetORM
from app.services.change_type_mapping import resolve_change_type
from app.services.raster_preflight import (
    PairPreflight,
    RasterPreflight,
    build_pair_preflight,
    build_pair_preflight_fast_safe,
)
from app.services.sheet_chip_manifest import build_sheet_chip_manifest
from app.services.sheet_chip_writer import (
    filter_manifest_by_common_valid_data,
    write_sheet_chips,
)
from app.services.task_artifacts import task_artifact_dir


@dataclass(frozen=True)
class EngineDetectionRecord:
    sheet_code: str
    model: str
    change_type: str
    confidence: float
    area_m2: float
    geometry_wkt_5186: str
    region_code: str = ""
    address: str = ""
    memo: str = ""


@dataclass(frozen=True)
class AlgorithmSpec:
    script: str
    model_dir: str
    confidence_threshold: float
    min_area_m2: float
    simplify_tolerance: float
    min_component_pixels: int | None = None


@dataclass(frozen=True)
class PreparedImagePair:
    dataset_name: str
    mode: str


@dataclass(frozen=True)
class PreparedImageInputs:
    dataset_names: tuple[str, ...]
    mode: str
    input_root: Path
    core_geometries_5186: dict[str, BaseGeometry] | None = None
    valid_mask_paths_5186: dict[str, Path] | None = None


def prepare_shared_algorithm_inputs(
    *,
    settings: Settings,
    task_id: str,
    standard_path: str,
    compare_path: str,
    sheets: Iterable[MapSheetORM],
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
) -> PreparedImageInputs:
    """Prepare task-scoped T1/T2 inputs once so multiple models can reuse them."""
    input_root = task_artifact_dir(settings, task_id) / "input"
    if input_root.exists():
        shutil.rmtree(input_root)
    input_root.mkdir(parents=True, exist_ok=True)
    return _prepare_algorithm_inputs(
        settings=settings,
        standard_path=standard_path,
        compare_path=compare_path,
        sheets=list(sheets),
        input_root=input_root,
        progress_callback=progress_callback,
    )


def run_algorithm_category(
    *,
    settings: Settings,
    task_id: str,
    category: str,
    standard_path: str,
    compare_path: str,
    sheets: Iterable[MapSheetORM],
    prepared_inputs: PreparedImageInputs | None = None,
    process_env: dict[str, str] | None = None,
    cancel_event: Event | None = None,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
) -> list[EngineDetectionRecord]:
    """Prepare one image pair, run one algorithm, and map GeoJSON output to sheets."""
    spec = _algorithm_spec(settings, category)
    workspace = task_artifact_dir(settings, task_id) / category
    if workspace.exists():
        shutil.rmtree(workspace)
    output_dir = workspace / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    target_sheets = list(sheets)
    sheet_geoms = [
        (sheet.code, _sheet_geometry_5186(sheet.geometry))
        for sheet in target_sheets
    ]
    if not sheet_geoms:
        return []

    if prepared_inputs is None:
        input_root = workspace / "input"
        input_root.mkdir(parents=True, exist_ok=True)
        prepared_inputs = _prepare_algorithm_inputs(
            settings=settings,
            standard_path=standard_path,
            compare_path=compare_path,
            sheets=target_sheets,
            input_root=input_root,
            progress_callback=progress_callback,
        )
    else:
        input_root = prepared_inputs.input_root
    print(
        f"[engine] task={task_id} category={category} "
        f"inputs={len(prepared_inputs.dataset_names)} mode={prepared_inputs.mode}",
        flush=True,
    )
    _emit_engine_status(
        progress_callback,
        current_task="algorithm starting",
        process=5,
        detail_message="모델 실행 준비 중",
        current_step=1,
        total_step=max(1, len(prepared_inputs.dataset_names)),
        extra={
            "prepare_mode": prepared_inputs.mode,
            "chip_count": len(prepared_inputs.dataset_names),
        },
    )
    _run_algorithm(
        settings,
        spec,
        input_root,
        output_dir,
        progress_callback,
        process_env=process_env,
        cancel_event=cancel_event,
    )

    records: list[EngineDetectionRecord] = []
    for dataset_name in prepared_inputs.dataset_names:
        output_json = output_dir / f"{dataset_name}.json"
        if not output_json.exists():
            print(f"[engine] missing output json: {output_json}", flush=True)
            continue
        clip_geom = (
            prepared_inputs.core_geometries_5186 or {}
        ).get(dataset_name)
        valid_mask_path = (
            prepared_inputs.valid_mask_paths_5186 or {}
        ).get(dataset_name)
        records.extend(
            _parse_geojson(
                output_json,
                category=category,
                sheet_geoms=sheet_geoms,
                clip_geometry_5186=clip_geom,
                valid_mask_path_5186=valid_mask_path,
                valid_mask_min_ratio=float(
                    getattr(settings, "change_detection_output_valid_mask_min_ratio", 0.5)
                ),
            )
        )
    print(
        f"[engine] task={task_id} category={category} parsed_records={len(records)}",
        flush=True,
    )
    return records


def _algorithm_spec(settings: Settings, category: str) -> AlgorithmSpec:
    root = Path(settings.change_detection_algorithm_root)
    if category == "road":
        workspace = _resolve_algorithm_workspace(
            root,
            category="road",
            candidates=("02_Road_CD", "Road_CD"),
        )
        return AlgorithmSpec(
            script=str(workspace / "predict.py"),
            model_dir=str(workspace / "model"),
            confidence_threshold=settings.road_confidence_threshold,
            min_area_m2=settings.road_min_area_m2,
            simplify_tolerance=settings.road_simplify_tolerance,
        )
    if category == "building":
        workspace = _resolve_algorithm_workspace(
            root,
            category="building",
            candidates=("04_Building_CD", "Building_CD"),
        )
        return AlgorithmSpec(
            script=str(workspace / "predict.py"),
            model_dir=str(workspace / "model"),
            confidence_threshold=settings.building_confidence_threshold,
            min_area_m2=settings.building_min_area_m2,
            simplify_tolerance=settings.building_simplify_tolerance,
            min_component_pixels=settings.building_min_component_pixels,
        )
    raise ValueError(f"unsupported change-detection category: {category}")


def _resolve_algorithm_workspace(
    root: Path,
    *,
    category: str,
    candidates: tuple[str, ...],
) -> Path:
    """Resolve PM submodule layout first, with legacy engines layout fallback."""
    checked: list[Path] = []
    for dirname in candidates:
        workspace = root / dirname / "workspace"
        checked.append(workspace)
        if (workspace / "predict.py").is_file():
            return workspace
    checked_text = ", ".join(str(path) for path in checked)
    raise FileNotFoundError(
        f"change-detection {category} workspace not found under "
        f"{root}; checked: {checked_text}"
    )


def _prepare_algorithm_inputs(
    *,
    settings: Settings,
    standard_path: str,
    compare_path: str,
    sheets: list[MapSheetORM],
    input_root: Path,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
) -> PreparedImageInputs:
    mode = settings.change_detection_prepare_mode.strip().lower()
    if mode in {"legacy", "full", "full-image"}:
        pair = _prepare_image_pair(
            standard_path=standard_path,
            compare_path=compare_path,
            sheets=sheets,
            output_t1=input_root / "T1" / "full.tif",
            output_t2=input_root / "T2" / "full.tif",
            crop_pixels=settings.change_detection_crop_pixels,
        )
        return PreparedImageInputs(
            dataset_names=(pair.dataset_name,),
            mode=pair.mode,
            input_root=input_root,
        )
    if mode in {"sheet", "sheet_12cm", "sheet-chips", "sheet_chips"}:
        return _prepare_sheet_chip_inputs(
            settings=settings,
            standard_path=standard_path,
            compare_path=compare_path,
            sheets=sheets,
            input_root=input_root,
            progress_callback=progress_callback,
        )
    raise ValueError(f"unsupported CHANGE_DETECTION_PREPARE_MODE: {settings.change_detection_prepare_mode}")


def _prepare_sheet_chip_inputs(
    *,
    settings: Settings,
    standard_path: str,
    compare_path: str,
    sheets: list[MapSheetORM],
    input_root: Path,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
) -> PreparedImageInputs:
    _emit_engine_status(
        progress_callback,
        current_task="preflight in progress",
        process=1,
        detail_message="대상 도엽 범위의 과년도·당해년도 실제 footprint와 해상도 확인 중",
    )
    target_geometry_5186 = unary_union(
        [_sheet_geometry_5186(sheet.geometry) for sheet in sheets]
    )
    if settings.change_detection_sheet_buffer_m > 0:
        target_geometry_5186 = target_geometry_5186.buffer(
            settings.change_detection_sheet_buffer_m
        )

    def on_preflight_progress(event: dict[str, Any]) -> None:
        _emit_engine_status(
            progress_callback,
            current_task="preflight in progress",
            process=1,
            detail_message=_preflight_progress_message(event),
            current_step=_safe_optional_int(event.get("window_index")),
            total_step=_safe_optional_int(event.get("window_count")),
            extra={
                "source": event.get("path"),
                "preflight_label": event.get("label"),
                "preflight_phase": event.get("phase"),
                "valid_pixel_count": event.get("valid_pixel_count"),
                "polygon_count": event.get("polygon_count"),
                "cache_path": event.get("cache_path"),
                "band_count": event.get("band_count"),
                "rgb_nodata_color": event.get("rgb_nodata_color"),
                "rgb_nodata_tolerance": event.get("rgb_nodata_tolerance"),
            },
        )

    preflight_mode = str(
        getattr(settings, "change_detection_preflight_mode", "fast_safe")
    ).strip().lower()
    rgb_nodata_tolerance = int(
        getattr(settings, "change_detection_preflight_rgb_nodata_tolerance", 3)
    )
    if preflight_mode in {"exact", "exact_actual", "exact_actual_footprint"}:
        preflight_cache_dir = (
            Path(getattr(settings, "change_detection_preflight_cache_root", "/data/storage/preflight-cache"))
            if bool(getattr(settings, "change_detection_preflight_cache_enabled", True))
            else None
        )
        pair = build_pair_preflight(
            standard_path,
            compare_path,
            target_gsd_m=settings.change_detection_target_gsd_m,
            clip_geometry_5186=target_geometry_5186,
            cache_dir=preflight_cache_dir,
            progress_callback=on_preflight_progress,
            progress_interval_s=float(
                getattr(settings, "change_detection_preflight_progress_interval_s", 2.0)
            ),
            rgb_nodata_tolerance=rgb_nodata_tolerance,
            rgb_nodata_sieve_pixels=int(
                getattr(
                    settings,
                    "change_detection_preflight_rgb_nodata_sieve_pixels",
                    getattr(settings, "change_detection_preflight_rgb_zero_sieve_pixels", 16),
                )
            ),
        )
    else:
        pair = build_pair_preflight_fast_safe(
            standard_path,
            compare_path,
            target_gsd_m=settings.change_detection_target_gsd_m,
            clip_geometry_5186=target_geometry_5186,
            progress_callback=on_preflight_progress,
            rgb_nodata_tolerance=rgb_nodata_tolerance,
        )
    analysis = _pair_analysis_summary(pair)
    if pair.intersection_area_m2 <= 0:
        raise ValueError("과년도·당해년도 actual footprints do not overlap after CRS normalization")

    _emit_engine_status(
        progress_callback,
        current_task="sheet manifest in progress",
        process=2,
        detail_message="교차 footprint 기준 도엽 처리 범위 계산 중",
        total_step=max(1, len(sheets)),
        extra={
            "analysis": analysis,
            "intersection_area_m2": pair.intersection_area_m2,
            "overlap_ratio": pair.overlap_ratio,
            "overlap_method": pair.overlap_method,
            "target_gsd_m": settings.change_detection_target_gsd_m,
            "buffer_m": settings.change_detection_sheet_buffer_m,
        },
    )
    manifest = build_sheet_chip_manifest(
        pair,
        sheets,
        buffer_m=settings.change_detection_sheet_buffer_m,
        target_gsd_m=settings.change_detection_target_gsd_m,
    )
    if not manifest.chips:
        skipped = ", ".join(f"{item.sheet_code}:{item.reason}" for item in manifest.skipped_sheets)
        raise ValueError(f"no sheet chips to process ({skipped})")

    def on_sheet_prefilter_progress(status: dict[str, Any]) -> None:
        sheet_code = str(status.get("sheet_code") or "")
        index = status.get("sheet_index")
        total = status.get("sheet_count")
        ratio = status.get("common_valid_ratio")
        ratio_pct = (
            f"{float(ratio) * 100:.2f}%"
            if isinstance(ratio, (float, int))
            else "-"
        )
        if status.get("skipped"):
            message = f"nodata 도엽 사전 제외 · {sheet_code} · valid {ratio_pct}"
        else:
            message = f"도엽 valid 영역 사전 확인 중 · {sheet_code} {index}/{total}"
        _emit_engine_status(
            progress_callback,
            current_task="sheet valid prefilter in progress",
            process=3,
            detail_message=message,
            current_step=int(index) if isinstance(index, int) else None,
            total_step=int(total) if isinstance(total, int) else None,
            final_name=sheet_code or None,
            extra=status,
        )

    if bool(getattr(settings, "change_detection_sheet_prefilter_enabled", True)):
        _emit_engine_status(
            progress_callback,
            current_task="sheet valid prefilter in progress",
            process=3,
            detail_message="도엽별 T1/T2 공통 valid 영역 사전 확인 중",
            current_step=0,
            total_step=len(manifest.chips),
            extra={
                "chip_count": len(manifest.chips),
                "skipped_count": len(manifest.skipped_sheets),
                "max_sample_pixels": int(
                    getattr(settings, "change_detection_sheet_prefilter_max_sample_pixels", 262_144)
                ),
                "min_valid_ratio": float(
                    getattr(settings, "change_detection_sheet_prefilter_min_valid_ratio", 0.0)
                ),
            },
        )
        manifest = filter_manifest_by_common_valid_data(
            pair,
            manifest,
            max_sample_pixels=int(
                getattr(settings, "change_detection_sheet_prefilter_max_sample_pixels", 262_144)
            ),
            min_valid_ratio=float(
                getattr(settings, "change_detection_sheet_prefilter_min_valid_ratio", 0.0)
            ),
            progress_callback=on_sheet_prefilter_progress,
        )
        if not manifest.chips:
            skipped = ", ".join(
                f"{item.sheet_code}:{item.reason}" for item in manifest.skipped_sheets
            )
            raise ValueError(f"no sheet chips with common valid data ({skipped})")

    _emit_engine_status(
        progress_callback,
        current_task="resampling in progress",
        process=3,
        detail_message="12cm 리샘플링 및 도엽 칩 생성 준비 중",
        current_step=0,
        total_step=max(1, len(manifest.chips) * 2),
        extra={
            "chip_count": len(manifest.chips),
            "skipped_count": len(manifest.skipped_sheets),
            "target_gsd_m": settings.change_detection_target_gsd_m,
            "buffer_m": settings.change_detection_sheet_buffer_m,
            "resampling": settings.change_detection_resampling,
        },
    )

    def on_chip_progress(status: dict[str, Any]) -> None:
        source = str(status.get("source") or "")
        sheet_code = str(status.get("sheet_code") or "")
        step = status.get("current_step")
        total = status.get("total_step")
        block_index = status.get("block_index")
        block_count = status.get("block_count")
        if status.get("skipped"):
            message = f"nodata만 있는 도엽 제외 · {sheet_code}"
        else:
            message = f"12cm 리샘플링 중 · {source} {step}/{total}"
        if block_index and block_count:
            message += f" · 블록 {block_index}/{block_count}"
        _emit_engine_status(
            progress_callback,
            current_task="resampling in progress",
            process=4,
            detail_message=message,
            current_step=int(step) if isinstance(step, int) else None,
            total_step=int(total) if isinstance(total, int) else None,
            final_name=sheet_code or None,
            extra=status,
        )

    written = write_sheet_chips(
        pair,
        manifest,
        input_root,
        resampling=settings.change_detection_resampling,
        progress_callback=on_chip_progress,
    )
    if not written:
        skipped = ", ".join(
            f"{item.sheet_code}:{item.reason}" for item in manifest.skipped_sheets
        )
        raise ValueError(
            "no sheet chips with valid pixels after nodata masking"
            + (f" ({skipped})" if skipped else "")
        )
    dataset_names = tuple(item.sheet_code for item in written)
    core_geometries = {
        chip.sheet_code: chip.core_geometry_5186
        for chip in manifest.chips
        if chip.sheet_code in dataset_names
    }
    valid_mask_paths = {
        item.sheet_code: item.valid_mask_path
        for item in written
    }
    print(
        "[engine] sheet-chip preparation: "
        f"chips={len(written)}, skipped={len(manifest.skipped_sheets)}, "
        f"target_gsd={settings.change_detection_target_gsd_m}, "
        f"buffer_m={settings.change_detection_sheet_buffer_m}",
        flush=True,
    )
    for warning in pair.warnings:
        print(
            f"[engine][preflight][{warning.severity}] {warning.code}: {warning.message}",
            flush=True,
        )
    _emit_engine_status(
        progress_callback,
        current_task="resampling done",
        process=5,
        detail_message="도엽 칩 생성 완료",
        current_step=len(written),
        total_step=max(1, len(manifest.chips)),
        extra={
            "chip_count": len(written),
            "skipped_count": len(manifest.skipped_sheets),
            "target_gsd_m": settings.change_detection_target_gsd_m,
            "buffer_m": settings.change_detection_sheet_buffer_m,
            "resampling": settings.change_detection_resampling,
        },
    )
    return PreparedImageInputs(
        dataset_names=dataset_names,
        mode="sheet_12cm",
        input_root=input_root,
        core_geometries_5186=core_geometries,
        valid_mask_paths_5186=valid_mask_paths,
    )


def _emit_engine_status(
    progress_callback: Callable[[dict[str, Any]], None] | None,
    *,
    current_task: str,
    process: int,
    detail_message: str,
    current_step: int | None = None,
    total_step: int | None = None,
    final_name: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    if progress_callback is None:
        return
    status: dict[str, Any] = {
        "Status": "running",
        "CurrentTask": current_task,
        "Process": process,
        "DetailMessage": detail_message,
    }
    if current_step is not None:
        status["Current_step"] = current_step
    if total_step is not None:
        status["Total_step"] = total_step
    if final_name:
        status["final_name"] = final_name
    if extra:
        status.update(extra)
    progress_callback(status)


def _safe_optional_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _preflight_progress_message(event: dict[str, Any]) -> str:
    label = str(event.get("label") or "입력 영상")
    phase = str(event.get("phase") or "")
    window_index = event.get("window_index")
    window_count = event.get("window_count")
    if phase == "cache_hit":
        return f"{label} actual footprint 캐시 사용 중"
    if phase == "cache_miss":
        return f"{label} actual footprint 캐시 없음, 픽셀 스캔 준비 중"
    if phase == "cache_write":
        return f"{label} actual footprint 캐시 저장 중"
    if phase == "intersection":
        return "과년도·당해년도 actual footprint 교차영역 계산 중"
    if phase == "fast_bounds":
        return f"{label} bounds 및 nodata pixel mask 규칙 확인 중"
    if phase == "fast_intersection":
        return "과년도·당해년도 bounds 교차영역 계산 중"
    if phase == "geometry_fallback":
        return "actual footprint geometry 복잡도 초과, bounds fallback 적용 중"
    if phase == "bounds":
        return f"{label} actual footprint nodata 정보 없음, bounds 사용 중"
    if phase == "polygonize":
        if window_index and window_count:
            return f"{label} actual footprint 벡터화 중 ({window_index}/{window_count})"
        return f"{label} actual footprint 벡터화 중"
    if phase == "union":
        return f"{label} actual footprint 폴리곤 병합 중"
    if phase == "done":
        return f"{label} actual footprint 계산 완료"
    if window_index is not None and window_count:
        return f"{label} actual footprint 픽셀 스캔 중 ({window_index}/{window_count})"
    return f"{label} actual footprint 픽셀 스캔 중"


def _pair_analysis_summary(pair: PairPreflight) -> dict[str, Any]:
    return {
        "standard": _raster_analysis_summary(pair.standard),
        "compare": _raster_analysis_summary(pair.compare),
        "target_gsd_m": pair.target_gsd_m,
        "intersection_area_m2": pair.intersection_area_m2,
        "overlap_ratio": pair.overlap_ratio,
        "overlap_method": pair.overlap_method,
        "intersection_bounds_5186": (
            [float(v) for v in pair.intersection_5186.bounds]
            if not pair.intersection_5186.is_empty
            else None
        ),
        "can_proceed": pair.intersection_area_m2 > 0,
        "warnings": [
            {
                "code": warning.code,
                "severity": warning.severity,
                "message": warning.message,
                "details": warning.details,
            }
            for warning in pair.warnings
        ],
    }


def _raster_analysis_summary(raster: RasterPreflight) -> dict[str, Any]:
    return {
        "path": raster.path,
        "crs": raster.crs,
        "width": raster.width,
        "height": raster.height,
        "band_count": raster.band_count,
        "gsd_x_m": raster.gsd_x_m,
        "gsd_y_m": raster.gsd_y_m,
        "mean_gsd_m": raster.mean_gsd_m,
        "footprint_area_m2": float(raster.footprint_5186.area),
        "footprint_method": raster.footprint_method,
        "valid_pixel_count": raster.valid_pixel_count,
        "rgb_nodata_color": raster.rgb_nodata_color,
        "rgb_nodata_tolerance": raster.rgb_nodata_tolerance,
        "rgb_nodata_source": raster.rgb_nodata_source,
    }


def _prepare_image_pair(
    *,
    standard_path: str,
    compare_path: str,
    sheets: list[MapSheetORM],
    output_t1: Path,
    output_t2: Path,
    crop_pixels: int,
) -> PreparedImagePair:
    """Prepare the algorithm input pair.

    Production uses the merged source TIFFs directly via symlink. The algorithm
    scripts read only bands 1, 2, and 3, so RGBA/RGB pairs do not need a copied
    normalized full-image input. ``crop_pixels`` is only for fast smoke tests.
    """
    with rasterio.open(standard_path) as standard, rasterio.open(compare_path) as compare:
        if standard.crs != compare.crs:
            raise ValueError(
                f"dataset CRS mismatch: standard={standard.crs}, compare={compare.crs}"
            )
        if standard.count < 3 or compare.count < 3:
            raise ValueError(
                "datasets must have at least 3 bands: "
                f"standard={standard.count}, compare={compare.count}"
            )
        overlap_bounds = _intersect_bounds(
            _dataset_bounds(standard),
            _dataset_bounds(compare),
        )
        if overlap_bounds is None:
            raise ValueError("datasets do not overlap in their shared CRS")

        if crop_pixels <= 0:
            if _can_use_direct_pair(standard, compare):
                output_t1.parent.mkdir(parents=True, exist_ok=True)
                output_t2.parent.mkdir(parents=True, exist_ok=True)
                _symlink_or_replace(standard_path, output_t1)
                _symlink_or_replace(compare_path, output_t2)
                return PreparedImagePair(output_t1.stem, "full-image")

            window = _window_inside_bounds(overlap_bounds, standard)
            mode = "overlap-crop"
        else:
            geom_5186 = unary_union(
                [_sheet_geometry_5186(sheet.geometry) for sheet in sheets]
            )
            geom_src = _transform_geometry(geom_5186, "EPSG:5186", str(standard.crs))
            target_bounds = _intersect_bounds(overlap_bounds, geom_src.bounds)
            if target_bounds is None:
                raise ValueError("target sheets do not overlap both datasets")
            window = _window_inside_bounds(target_bounds, standard)
            window = _center_crop_window(window, crop_pixels)
            mode = "sample-overlap-crop"

        if window.width <= 0 or window.height <= 0:
            raise ValueError("overlap area is too small for change detection")

        _write_aligned_pair(standard, compare, window, output_t1, output_t2)
        return PreparedImagePair(output_t1.stem, mode)


def _symlink_or_replace(source: str, destination: Path) -> None:
    _unlink_existing(destination)
    os.symlink(source, destination)


def _unlink_existing(path: Path) -> None:
    if path.exists() or path.is_symlink():
        path.unlink()


def _dataset_bounds(dataset: Any) -> tuple[float, float, float, float]:
    bounds = dataset.bounds
    return (float(bounds.left), float(bounds.bottom), float(bounds.right), float(bounds.top))


def _intersect_bounds(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
) -> tuple[float, float, float, float] | None:
    left = max(float(a[0]), float(b[0]))
    bottom = max(float(a[1]), float(b[1]))
    right = min(float(a[2]), float(b[2]))
    top = min(float(a[3]), float(b[3]))
    if right <= left or top <= bottom:
        return None
    return (left, bottom, right, top)


def _can_use_direct_pair(standard: Any, compare: Any) -> bool:
    if (standard.width, standard.height) != (compare.width, compare.height):
        return False
    x_res = max(abs(float(standard.res[0])), abs(float(compare.res[0])))
    y_res = max(abs(float(standard.res[1])), abs(float(compare.res[1])))
    if not math.isclose(float(standard.res[0]), float(compare.res[0]), abs_tol=x_res * 1e-3):
        return False
    if not math.isclose(float(standard.res[1]), float(compare.res[1]), abs_tol=y_res * 1e-3):
        return False
    x_tol = x_res * 0.5
    y_tol = y_res * 0.5
    standard_bounds = _dataset_bounds(standard)
    compare_bounds = _dataset_bounds(compare)
    return (
        abs(standard_bounds[0] - compare_bounds[0]) <= x_tol
        and abs(standard_bounds[1] - compare_bounds[1]) <= y_tol
        and abs(standard_bounds[2] - compare_bounds[2]) <= x_tol
        and abs(standard_bounds[3] - compare_bounds[3]) <= y_tol
    )


def _sheet_geometry_5186(geometry: Any) -> BaseGeometry:
    raw = getattr(geometry, "desc", geometry)
    if isinstance(raw, str):
        return wkb.loads(bytes.fromhex(raw))
    return wkb.loads(raw)


def _transform_geometry(geom: BaseGeometry, src_crs: str, dst_crs: str) -> BaseGeometry:
    if src_crs == dst_crs:
        return geom
    transformer = Transformer.from_crs(src_crs, dst_crs, always_xy=True)
    return transform(transformer.transform, geom)


def _window_inside_bounds(
    bounds: tuple[float, float, float, float],
    dataset: Any,
) -> Window:
    """Return an integer window on ``dataset`` fully contained by ``bounds``."""
    raw = from_bounds(*bounds, transform=dataset.transform)
    col_start = max(0, math.ceil(raw.col_off - 1e-9))
    row_start = max(0, math.ceil(raw.row_off - 1e-9))
    col_stop = min(dataset.width, math.floor(raw.col_off + raw.width + 1e-9))
    row_stop = min(dataset.height, math.floor(raw.row_off + raw.height + 1e-9))
    return Window(
        col_off=col_start,
        row_off=row_start,
        width=max(0, col_stop - col_start),
        height=max(0, row_stop - row_start),
    )


def _center_crop_window(window: Window, crop_pixels: int) -> Window:
    if crop_pixels <= 0:
        return window
    size = int(min(crop_pixels, window.width, window.height))
    col_off = int(window.col_off + max(0, (window.width - size) // 2))
    row_off = int(window.row_off + max(0, (window.height - size) // 2))
    return Window(col_off=col_off, row_off=row_off, width=size, height=size)


def _write_aligned_pair(
    standard: Any,
    compare: Any,
    standard_window: Window,
    output_t1: Path,
    output_t2: Path,
) -> None:
    """Write T1 directly and T2 resampled onto the same overlap grid."""
    width = int(standard_window.width)
    height = int(standard_window.height)
    transform = standard.window_transform(standard_window)
    profile = standard.profile.copy()
    profile.update(
        driver="GTiff",
        height=height,
        width=width,
        count=3,
        transform=transform,
        tiled=True,
        blockxsize=_tile_size(width),
        blockysize=_tile_size(height),
        compress="lzw",
        BIGTIFF="IF_SAFER",
    )

    output_t1.parent.mkdir(parents=True, exist_ok=True)
    output_t2.parent.mkdir(parents=True, exist_ok=True)
    _unlink_existing(output_t1)
    _unlink_existing(output_t2)

    with rasterio.open(output_t1, "w", **profile) as dst:
        for _, dst_window in dst.block_windows(1):
            src_window = Window(
                col_off=standard_window.col_off + dst_window.col_off,
                row_off=standard_window.row_off + dst_window.row_off,
                width=dst_window.width,
                height=dst_window.height,
            )
            data = standard.read(indexes=(1, 2, 3), window=src_window)
            dst.write(data, window=dst_window)

    with WarpedVRT(
        compare,
        crs=standard.crs,
        transform=transform,
        width=width,
        height=height,
        resampling=Resampling.bilinear,
    ) as vrt, rasterio.open(output_t2, "w", **profile) as dst:
        for _, dst_window in dst.block_windows(1):
            data = vrt.read(indexes=(1, 2, 3), window=dst_window)
            dst.write(data, window=dst_window)


def _tile_size(length: int) -> int:
    if length >= 512:
        return 512
    return max(16, int(math.ceil(length / 16) * 16))


def _run_algorithm(
    settings: Settings,
    spec: AlgorithmSpec,
    dataset_dir: Path,
    output_dir: Path,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
    *,
    process_env: dict[str, str] | None = None,
    cancel_event: Event | None = None,
) -> None:
    script = Path(spec.script)
    model_dir = Path(spec.model_dir)
    if not script.exists():
        raise FileNotFoundError(f"algorithm script not found: {script}")
    if not model_dir.exists():
        raise FileNotFoundError(f"algorithm model directory not found: {model_dir}")

    cmd = [
        sys.executable,
        str(script),
        "--dataset_path",
        str(dataset_dir),
        "--output_path",
        str(output_dir),
        "--model_path",
        str(model_dir),
        "--patch_size",
        str(settings.change_detection_patch_size),
        "--overlap_ratio",
        str(settings.change_detection_overlap_ratio),
        "--batch_size",
        str(settings.change_detection_batch_size),
        "--confidence_threshold",
        str(spec.confidence_threshold),
        "--min_area_m2",
        str(spec.min_area_m2),
        "--simplify_tolerance",
        str(spec.simplify_tolerance),
        "--status_file",
        str(output_dir / "status.json"),
    ]
    if spec.min_component_pixels is not None:
        cmd.extend(["--min_component_pixels", str(spec.min_component_pixels)])

    log_path = output_dir / "engine.log"
    status_path = output_dir / "status.json"
    child_env = os.environ.copy()
    if process_env:
        child_env.update(process_env)
    gpu_hint = child_env.get("CUDA_VISIBLE_DEVICES")
    gpu_suffix = f" cuda={gpu_hint}" if gpu_hint else ""
    print(f"[engine] running{gpu_suffix}: {' '.join(cmd)}", flush=True)
    with log_path.open("w", encoding="utf-8") as log:
        log.write("$ " + " ".join(cmd) + "\n\n")
        if gpu_hint:
            log.write(f"# CUDA_VISIBLE_DEVICES={gpu_hint}\n\n")
        log.flush()
        process = subprocess.Popen(
            cmd,
            cwd=str(script.parent),
            env=child_env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1,
        )
        assert process.stdout is not None
        last_status_mtime = 0.0

        def emit_status(force: bool = False) -> None:
            nonlocal last_status_mtime
            if progress_callback is None or not status_path.exists():
                return
            try:
                mtime = status_path.stat().st_mtime
                if not force and mtime == last_status_mtime:
                    return
                status = json.loads(status_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                return
            last_status_mtime = mtime
            progress_callback(status)

        while True:
            if cancel_event is not None and cancel_event.is_set():
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                raise RuntimeError(
                    "change-detection algorithm cancelled; "
                    f"log={log_path}"
                )
            ready, _, _ = select.select([process.stdout], [], [], 1.0)
            if ready:
                line = process.stdout.readline()
                if line:
                    log.write(line)
                    log.flush()
                    print(f"[algorithm] {line}", end="", flush=True)
                elif process.poll() is not None:
                    break
            emit_status()
            if process.poll() is not None:
                rest = process.stdout.read()
                if rest:
                    log.write(rest)
                    log.flush()
                    for line in rest.splitlines(keepends=True):
                        print(f"[algorithm] {line}", end="", flush=True)
                break
        emit_status(force=True)
        returncode = process.wait()
    if returncode != 0:
        raise RuntimeError(
            f"change-detection algorithm failed with exit code {returncode}; "
            f"log={log_path}"
        )


def _parse_geojson(
    output_json: Path,
    *,
    category: str,
    sheet_geoms: list[tuple[str, BaseGeometry]],
    clip_geometry_5186: BaseGeometry | None = None,
    valid_mask_path_5186: Path | None = None,
    valid_mask_min_ratio: float = 0.5,
) -> list[EngineDetectionRecord]:
    data = json.loads(output_json.read_text(encoding="utf-8"))
    crs = _geojson_epsg(data)
    records: list[EngineDetectionRecord] = []
    valid_mask_src = None
    if valid_mask_path_5186 is not None and valid_mask_path_5186.exists():
        valid_mask_src = rasterio.open(valid_mask_path_5186)
    try:
        min_valid_ratio = min(1.0, max(0.0, float(valid_mask_min_ratio)))
        for feature in data.get("features", []):
            props = feature.get("properties") or {}
            cls_id = props.get("CLS_ID", props.get("type"))
            change_type = resolve_change_type(category, cls_id)
            if not change_type:
                continue
            geom = feature.get("geometry")
            if not geom:
                continue
            geom_5186 = _geometry_to_5186(geom, crs)
            if clip_geometry_5186 is not None:
                geom_5186 = geom_5186.intersection(clip_geometry_5186)

            for record_geom in _record_geometries(geom_5186):
                if (
                    valid_mask_src is not None
                    and _valid_mask_area_ratio(record_geom, valid_mask_src) < min_valid_ratio
                ):
                    continue
                sheet_code = _assign_sheet_code(record_geom, sheet_geoms)
                if not sheet_code:
                    continue
                area_m2 = (
                    float(record_geom.area)
                    if clip_geometry_5186 is not None
                    else _to_float(props.get("AREA", props.get("area")), float(record_geom.area))
                )
                records.append(
                    EngineDetectionRecord(
                        sheet_code=sheet_code,
                        model=category,
                        change_type=change_type,
                        confidence=_to_float(props.get("CONF", props.get("accuracy")), 0.0),
                        area_m2=area_m2,
                        geometry_wkt_5186=record_geom.wkt,
                        region_code=str(props.get("region_code") or ""),
                        address=str(props.get("address") or ""),
                        memo=str(props.get("memo") or ""),
                    )
                )
    finally:
        if valid_mask_src is not None:
            valid_mask_src.close()
    return records


def _valid_mask_area_ratio(geom_5186: BaseGeometry, mask_src: rasterio.DatasetReader) -> float:
    if geom_5186.is_empty:
        return 0.0
    minx, miny, maxx, maxy = geom_5186.bounds
    bounds = mask_src.bounds
    left = max(float(minx), float(bounds.left))
    right = min(float(maxx), float(bounds.right))
    bottom = max(float(miny), float(bounds.bottom))
    top = min(float(maxy), float(bounds.top))
    if left >= right or bottom >= top:
        return 0.0

    window = from_bounds(left, bottom, right, top, transform=mask_src.transform)
    window = window.round_offsets().round_lengths()
    col_off = max(0, int(window.col_off))
    row_off = max(0, int(window.row_off))
    width = min(mask_src.width - col_off, max(1, int(window.width)))
    height = min(mask_src.height - row_off, max(1, int(window.height)))
    if width <= 0 or height <= 0:
        return 0.0

    # Very large detections are rare; fall back to a representative point to
    # avoid allocating huge temporary masks for pathological model output.
    if width * height > 2_000_000:
        return 1.0 if _point_is_valid_masked(geom_5186.representative_point(), mask_src) else 0.0

    clipped_window = Window(col_off, row_off, width, height)
    mask_data = mask_src.read(1, window=clipped_window)
    geom_mask = rasterize(
        [(geom_5186, 1)],
        out_shape=mask_data.shape,
        transform=mask_src.window_transform(clipped_window),
        fill=0,
        dtype=np.uint8,
        all_touched=True,
    )
    total = int(geom_mask.sum())
    if total <= 0:
        return 1.0 if _point_is_valid_masked(geom_5186.representative_point(), mask_src) else 0.0
    valid = int(np.logical_and(mask_data > 0, geom_mask > 0).sum())
    return float(valid / total)


def _point_is_valid_masked(point: BaseGeometry, mask_src: rasterio.DatasetReader) -> bool:
    if point.is_empty:
        return False
    bounds = mask_src.bounds
    x = float(point.x)
    y = float(point.y)
    if x < bounds.left or x > bounds.right or y < bounds.bottom or y > bounds.top:
        return False
    row, col = mask_src.index(x, y)
    if row < 0 or col < 0 or row >= mask_src.height or col >= mask_src.width:
        return False
    data = mask_src.read(1, window=Window(col, row, 1, 1))
    return bool(data.size and data[0, 0] > 0)


def _geojson_epsg(data: dict[str, Any]) -> int:
    crs_name = (
        ((data.get("crs") or {}).get("properties") or {}).get("name")
        or "EPSG:4326"
    )
    text = str(crs_name).upper()
    if "EPSG" in text:
        tail = text.rsplit("EPSG", 1)[-1]
        digits = "".join(ch for ch in tail if ch.isdigit())
        if digits:
            return int(digits)
    return 4326


def _geometry_to_5186(geometry: dict[str, Any], epsg: int) -> BaseGeometry:
    geom = shape(geometry)
    if epsg == 5186:
        return geom
    if epsg == 4326:
        return _transform_geometry(geom, "EPSG:4326", "EPSG:5186")
    transformer = Transformer.from_crs(epsg, 5186, always_xy=True)
    return transform(transformer.transform, geom)


def _assign_sheet_code(
    geom_5186: BaseGeometry,
    sheet_geoms: list[tuple[str, BaseGeometry]],
) -> str | None:
    if geom_5186.is_empty:
        return None
    point = geom_5186.representative_point()
    for code, sheet_geom in sheet_geoms:
        if sheet_geom.covers(point):
            return code

    best_code: str | None = None
    best_area = 0.0
    for code, sheet_geom in sheet_geoms:
        area = geom_5186.intersection(sheet_geom).area
        if area > best_area:
            best_code = code
            best_area = area
    return best_code


def _record_geometries(geom_5186: BaseGeometry) -> list[BaseGeometry]:
    """Return polygonal record geometries compatible with DetectionORM."""
    if geom_5186.is_empty or geom_5186.area <= 0:
        return []
    if geom_5186.geom_type == "Polygon":
        return [geom_5186]
    if geom_5186.geom_type == "MultiPolygon":
        return [part for part in geom_5186.geoms if not part.is_empty and part.area > 0]
    parts: list[BaseGeometry] = []
    for part in getattr(geom_5186, "geoms", []):
        parts.extend(_record_geometries(part))
    return parts


def _to_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default
