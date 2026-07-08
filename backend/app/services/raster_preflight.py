"""Raster preflight helpers for change-detection input preparation.

This module is intentionally independent from the current engine adapter.  It
lets us smoke-test footprint, CRS, and GSD decisions before replacing the
legacy full-image preparation path.
"""

from __future__ import annotations

import math
import hashlib
import json
import os
import time
from dataclasses import dataclass, field, replace
from pathlib import Path
from collections.abc import Callable, Iterator
from typing import Any, Literal

import numpy as np
import rasterio
from pyproj import Geod, Transformer
from rasterio.enums import ColorInterp
from rasterio.features import shapes, sieve
from rasterio.windows import Window, bounds as window_bounds, from_bounds
from shapely import wkb
from shapely.geometry import box, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform, unary_union


TARGET_CRS = "EPSG:5186"
TARGET_GSD_M = 0.12
RESOLUTION_STRONG_WARNING_RATIO = 0.30
RESOLUTION_MATCH_TOLERANCE_M = 0.0005
RASTER_PREFLIGHT_CACHE_VERSION = "actual-footprint-v4"
DEFAULT_RGB_NODATA_TOLERANCE = 3
DEFAULT_RGB_NODATA_SIEVE_PIXELS = 16
DEFAULT_RGB_ZERO_SIEVE_PIXELS = DEFAULT_RGB_NODATA_SIEVE_PIXELS
RGB_NODATA_SAMPLE_PIXELS = 64
RGB_NODATA_MIN_EDGE_RATIO = 0.20
MAX_EXACT_PAIR_GEOMETRY_WKB_BYTES = 64 * 1024 * 1024


WarningSeverity = Literal["warning", "strong"]
RasterProgressCallback = Callable[[dict[str, Any]], None]


@dataclass(frozen=True)
class RgbNodataRule:
    color: tuple[int, int, int]
    source: Literal["metadata", "inferred_edge"]
    tolerance: int


@dataclass(frozen=True)
class PreflightWarning:
    code: str
    severity: WarningSeverity
    message: str
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RasterPreflight:
    path: str
    crs: str
    width: int
    height: int
    band_count: int
    gsd_x_m: float
    gsd_y_m: float
    footprint_5186: BaseGeometry
    footprint_method: str
    valid_pixel_count: int
    rgb_nodata_color: tuple[int, int, int] | None = None
    rgb_nodata_tolerance: int | None = None
    rgb_nodata_source: str | None = None

    @property
    def mean_gsd_m(self) -> float:
        return (self.gsd_x_m + self.gsd_y_m) / 2.0


@dataclass(frozen=True)
class PairPreflight:
    standard: RasterPreflight
    compare: RasterPreflight
    intersection_5186: BaseGeometry
    target_gsd_m: float
    warnings: list[PreflightWarning]
    overlap_method: str = "actual_footprint"

    @property
    def intersection_area_m2(self) -> float:
        return float(self.intersection_5186.area) if not self.intersection_5186.is_empty else 0.0

    @property
    def overlap_ratio(self) -> float:
        standard = self.standard.footprint_5186
        compare = self.compare.footprint_5186
        if (
            _geometry_wkb_size(standard) + _geometry_wkb_size(compare)
            > MAX_EXACT_PAIR_GEOMETRY_WKB_BYTES
        ):
            standard = standard.envelope
            compare = compare.envelope
        union = standard.union(compare)
        if union.is_empty or union.area <= 0:
            return 0.0
        return self.intersection_area_m2 / float(union.area)


def analyze_raster_fast_safe(
    path: str | Path,
    *,
    clip_geometry_5186: BaseGeometry | None = None,
    progress_callback: RasterProgressCallback | None = None,
    progress_label: str | None = None,
    rgb_nodata_tolerance: int = DEFAULT_RGB_NODATA_TOLERANCE,
) -> RasterPreflight:
    """Fast metadata preflight for large sheet-chip processing.

    This deliberately avoids full-resolution mask polygonization.  The raster
    footprint is the dataset bounds, optionally clipped to the task sheet
    geometry.  Nodata is carried as a pixel-mask rule for chip writing.
    """

    raster_path = Path(path)
    with rasterio.open(str(raster_path)) as src:
        if src.crs is None:
            raise ValueError(f"raster has no CRS: {raster_path}")
        if src.count < 3:
            raise ValueError(f"raster must have at least 3 bands: {raster_path}")

        gsd_x_m, gsd_y_m = _estimate_gsd_m(src)
        clip_geometry = (
            _from_5186(clip_geometry_5186, src.crs)
            if clip_geometry_5186 is not None and not clip_geometry_5186.is_empty
            else None
        )
        footprint = _clip_if_needed(box(*_dataset_bounds(src)), clip_geometry)
        footprint_5186 = _to_5186(footprint, src.crs)
        rgb_nodata_rule = _rgb_nodata_rule(src, tolerance=rgb_nodata_tolerance)
        label = progress_label or raster_path.name
        _emit_raster_progress(
            progress_callback,
            phase="fast_bounds",
            label=label,
            path=str(raster_path),
            window_index=1,
            window_count=1,
            width=int(src.width),
            height=int(src.height),
            band_count=int(src.count),
            valid_pixel_count=_bounds_valid_pixel_count(src, footprint),
            polygon_count=1 if not footprint.is_empty else 0,
            rgb_nodata_color=(
                rgb_nodata_rule.color if rgb_nodata_rule is not None else None
            ),
            rgb_nodata_tolerance=(
                rgb_nodata_rule.tolerance if rgb_nodata_rule is not None else None
            ),
        )
        return RasterPreflight(
            path=str(raster_path),
            crs=src.crs.to_string(),
            width=int(src.width),
            height=int(src.height),
            band_count=int(src.count),
            gsd_x_m=gsd_x_m,
            gsd_y_m=gsd_y_m,
            footprint_5186=footprint_5186,
            footprint_method=_fast_safe_footprint_method(
                src,
                rgb_nodata_rule=rgb_nodata_rule,
            ),
            valid_pixel_count=_bounds_valid_pixel_count(src, footprint),
            rgb_nodata_color=(
                rgb_nodata_rule.color if rgb_nodata_rule is not None else None
            ),
            rgb_nodata_tolerance=(
                rgb_nodata_rule.tolerance if rgb_nodata_rule is not None else None
            ),
            rgb_nodata_source=(
                rgb_nodata_rule.source if rgb_nodata_rule is not None else None
            ),
        )


def analyze_raster(
    path: str | Path,
    *,
    chunk_size: int = 2048,
    clip_geometry_5186: BaseGeometry | None = None,
    cache_dir: str | Path | None = None,
    progress_callback: RasterProgressCallback | None = None,
    progress_label: str | None = None,
    progress_interval_s: float = 2.0,
    rgb_nodata_tolerance: int = DEFAULT_RGB_NODATA_TOLERANCE,
    rgb_nodata_sieve_pixels: int = DEFAULT_RGB_NODATA_SIEVE_PIXELS,
    rgb_zero_sieve_pixels: int | None = None,
) -> RasterPreflight:
    """Read raster metadata and derive a valid-data footprint in EPSG:5186.

    Valid data follows the current product decision:
    - 4+ band raster: pixels where at least one of the first 4 bands is non-zero.
    - 3 band raster: pixels outside the metadata/inferred RGB nodata color.
    """

    if rgb_zero_sieve_pixels is not None:
        rgb_nodata_sieve_pixels = rgb_zero_sieve_pixels
    rgb_nodata_tolerance = max(0, int(rgb_nodata_tolerance))
    rgb_nodata_sieve_pixels = max(0, int(rgb_nodata_sieve_pixels))
    raster_path = Path(path)
    with rasterio.open(str(raster_path)) as src:
        if src.crs is None:
            raise ValueError(f"raster has no CRS: {raster_path}")
        if src.count < 3:
            raise ValueError(f"raster must have at least 3 bands: {raster_path}")

        gsd_x_m, gsd_y_m = _estimate_gsd_m(src)
        clip_geometry = (
            _from_5186(clip_geometry_5186, src.crs)
            if clip_geometry_5186 is not None and not clip_geometry_5186.is_empty
            else None
        )
        label = progress_label or raster_path.name
        rgb_nodata_rule = _rgb_nodata_rule(src, tolerance=rgb_nodata_tolerance)
        cache_path = _raster_preflight_cache_path(
            src,
            raster_path,
            cache_dir=cache_dir,
            chunk_size=chunk_size,
            clip_geometry=clip_geometry,
            rgb_nodata_rule=rgb_nodata_rule,
            rgb_nodata_tolerance=rgb_nodata_tolerance,
            rgb_nodata_sieve_pixels=rgb_nodata_sieve_pixels,
        )
        if cache_path is not None:
            cached = _read_cached_raster_preflight(cache_path)
            if cached is not None:
                _emit_raster_progress(
                    progress_callback,
                    phase="cache_hit",
                    label=label,
                    path=str(raster_path),
                    cache_path=str(cache_path),
                    width=int(src.width),
                    height=int(src.height),
                    band_count=int(src.count),
                    rgb_nodata_color=(
                        rgb_nodata_rule.color if rgb_nodata_rule is not None else None
                    ),
                    rgb_nodata_tolerance=(
                        rgb_nodata_rule.tolerance if rgb_nodata_rule is not None else None
                    ),
                )
                return cached
            _emit_raster_progress(
                progress_callback,
                phase="cache_miss",
                label=label,
                path=str(raster_path),
                cache_path=str(cache_path),
                width=int(src.width),
                height=int(src.height),
                band_count=int(src.count),
                rgb_nodata_color=(
                    rgb_nodata_rule.color if rgb_nodata_rule is not None else None
                ),
                rgb_nodata_tolerance=(
                    rgb_nodata_rule.tolerance if rgb_nodata_rule is not None else None
                ),
            )
        else:
            _emit_raster_progress(
                progress_callback,
                phase="start",
                label=label,
                path=str(raster_path),
                width=int(src.width),
                height=int(src.height),
                band_count=int(src.count),
                rgb_nodata_color=(
                    rgb_nodata_rule.color if rgb_nodata_rule is not None else None
                ),
                rgb_nodata_tolerance=(
                    rgb_nodata_rule.tolerance if rgb_nodata_rule is not None else None
                ),
            )
        footprint, valid_pixel_count = _valid_data_footprint(
            src,
            chunk_size=chunk_size,
            clip_geometry=clip_geometry,
            progress_callback=progress_callback,
            progress_label=label,
            progress_path=str(raster_path),
            progress_interval_s=progress_interval_s,
            rgb_nodata_rule=rgb_nodata_rule,
            rgb_nodata_sieve_pixels=rgb_nodata_sieve_pixels,
        )
        footprint_5186 = _to_5186(footprint, src.crs)
        footprint_method = _footprint_method(
            src,
            rgb_nodata_rule=rgb_nodata_rule,
            rgb_nodata_sieve_pixels=rgb_nodata_sieve_pixels,
        )

        result = RasterPreflight(
            path=str(raster_path),
            crs=src.crs.to_string(),
            width=int(src.width),
            height=int(src.height),
            band_count=int(src.count),
            gsd_x_m=gsd_x_m,
            gsd_y_m=gsd_y_m,
            footprint_5186=footprint_5186,
            footprint_method=footprint_method,
            valid_pixel_count=valid_pixel_count,
            rgb_nodata_color=(
                rgb_nodata_rule.color if rgb_nodata_rule is not None else None
            ),
            rgb_nodata_tolerance=(
                rgb_nodata_rule.tolerance if rgb_nodata_rule is not None else None
            ),
            rgb_nodata_source=(
                rgb_nodata_rule.source if rgb_nodata_rule is not None else None
            ),
        )
        if cache_path is not None:
            _write_cached_raster_preflight(cache_path, result)
            _emit_raster_progress(
                progress_callback,
                phase="cache_write",
                label=label,
                path=str(raster_path),
                cache_path=str(cache_path),
                valid_pixel_count=valid_pixel_count,
                rgb_nodata_color=(
                    rgb_nodata_rule.color if rgb_nodata_rule is not None else None
                ),
                rgb_nodata_tolerance=(
                    rgb_nodata_rule.tolerance if rgb_nodata_rule is not None else None
                ),
            )
        return result


def analyze_raster_metadata(path: str | Path) -> RasterPreflight:
    """Read only raster profile metadata and derive an EPSG:5186 bounds footprint.

    This path intentionally avoids reading pixel data.  It is suitable for UI
    summaries shown before or during execution; actual nodata-aware footprints
    are still computed by ``analyze_raster`` inside the worker.
    """

    raster_path = Path(path)
    with rasterio.open(str(raster_path)) as src:
        if src.crs is None:
            raise ValueError(f"raster has no CRS: {raster_path}")
        if src.count < 3:
            raise ValueError(f"raster must have at least 3 bands: {raster_path}")

        gsd_x_m, gsd_y_m = _estimate_gsd_m(src)
        footprint_5186 = _to_5186(box(*_dataset_bounds(src)), src.crs)
        return RasterPreflight(
            path=str(raster_path),
            crs=src.crs.to_string(),
            width=int(src.width),
            height=int(src.height),
            band_count=int(src.count),
            gsd_x_m=gsd_x_m,
            gsd_y_m=gsd_y_m,
            footprint_5186=footprint_5186,
            footprint_method="bounds",
            valid_pixel_count=0,
        )


def build_pair_preflight(
    standard_path: str | Path,
    compare_path: str | Path,
    *,
    target_gsd_m: float = TARGET_GSD_M,
    chunk_size: int = 2048,
    clip_geometry_5186: BaseGeometry | None = None,
    cache_dir: str | Path | None = None,
    progress_callback: RasterProgressCallback | None = None,
    progress_interval_s: float = 2.0,
    rgb_nodata_tolerance: int = DEFAULT_RGB_NODATA_TOLERANCE,
    rgb_nodata_sieve_pixels: int = DEFAULT_RGB_NODATA_SIEVE_PIXELS,
    rgb_zero_sieve_pixels: int | None = None,
) -> PairPreflight:
    if rgb_zero_sieve_pixels is not None:
        rgb_nodata_sieve_pixels = rgb_zero_sieve_pixels
    standard = analyze_raster(
        standard_path,
        chunk_size=chunk_size,
        clip_geometry_5186=clip_geometry_5186,
        cache_dir=cache_dir,
        progress_callback=progress_callback,
        progress_label="과년도",
        progress_interval_s=progress_interval_s,
        rgb_nodata_tolerance=rgb_nodata_tolerance,
        rgb_nodata_sieve_pixels=rgb_nodata_sieve_pixels,
    )
    compare = analyze_raster(
        compare_path,
        chunk_size=chunk_size,
        clip_geometry_5186=clip_geometry_5186,
        cache_dir=cache_dir,
        progress_callback=progress_callback,
        progress_label="당해년도",
        progress_interval_s=progress_interval_s,
        rgb_nodata_tolerance=rgb_nodata_tolerance,
        rgb_nodata_sieve_pixels=rgb_nodata_sieve_pixels,
    )

    warnings: list[PreflightWarning] = []
    warnings.extend(_footprint_method_warnings("과년도", standard))
    warnings.extend(_footprint_method_warnings("당해년도", compare))
    for label, item in (("과년도", standard), ("당해년도", compare)):
        warning = resolution_warning(label, item.mean_gsd_m, target_gsd_m=target_gsd_m)
        if warning is not None:
            warnings.append(warning)

    if standard.crs != compare.crs:
        warnings.append(
            PreflightWarning(
                code="CRS_TRANSFORM_APPLIED",
                severity="warning",
                message="과년도·당해년도 CRS가 달라 EPSG:5186으로 변환해 교차 영역을 계산합니다.",
                details={"standard_crs": standard.crs, "compare_crs": compare.crs},
            )
        )

    _emit_raster_progress(
        progress_callback,
        phase="intersection",
        label="과년도·당해년도",
        path=None,
    )
    standard_wkb_bytes = _geometry_wkb_size(standard.footprint_5186)
    compare_wkb_bytes = _geometry_wkb_size(compare.footprint_5186)
    if standard_wkb_bytes + compare_wkb_bytes > MAX_EXACT_PAIR_GEOMETRY_WKB_BYTES:
        warnings.append(
            PreflightWarning(
                code="FOOTPRINT_GEOMETRY_COMPLEXITY_FALLBACK",
                severity="warning",
                message=(
                    "actual footprint geometry가 너무 복잡해 bounds 기반 교차영역으로 "
                    "fallback합니다."
                ),
                details={
                    "standard_wkb_bytes": standard_wkb_bytes,
                    "compare_wkb_bytes": compare_wkb_bytes,
                    "threshold_bytes": MAX_EXACT_PAIR_GEOMETRY_WKB_BYTES,
                },
            )
        )
        _emit_raster_progress(
            progress_callback,
            phase="geometry_fallback",
            label="과년도·당해년도",
            path=None,
            polygon_count=2,
        )
        standard = _with_bounds_fallback_footprint(standard)
        compare = _with_bounds_fallback_footprint(compare)
    intersection = standard.footprint_5186.intersection(compare.footprint_5186)
    if intersection.is_empty or intersection.area <= 0:
        warnings.append(
            PreflightWarning(
                code="FOOTPRINT_INTERSECTION_EMPTY",
                severity="strong",
                message="EPSG:5186 변환 후 과년도·당해년도 실제 footprint 교차 영역이 없습니다.",
                details={},
            )
        )

    return PairPreflight(
        standard=standard,
        compare=compare,
        intersection_5186=intersection,
        target_gsd_m=target_gsd_m,
        warnings=warnings,
        overlap_method="actual_footprint",
    )


def build_pair_preflight_fast_safe(
    standard_path: str | Path,
    compare_path: str | Path,
    *,
    target_gsd_m: float = TARGET_GSD_M,
    clip_geometry_5186: BaseGeometry | None = None,
    progress_callback: RasterProgressCallback | None = None,
    rgb_nodata_tolerance: int = DEFAULT_RGB_NODATA_TOLERANCE,
) -> PairPreflight:
    """Build a pair preflight without detailed mask polygon geometry.

    This is the default production path for sheet-chip processing.  It uses
    simple raster bounds for chip planning and leaves nodata handling to the
    pixel-mask stage in ``sheet_chip_writer``.
    """

    standard = analyze_raster_fast_safe(
        standard_path,
        clip_geometry_5186=clip_geometry_5186,
        progress_callback=progress_callback,
        progress_label="과년도",
        rgb_nodata_tolerance=rgb_nodata_tolerance,
    )
    compare = analyze_raster_fast_safe(
        compare_path,
        clip_geometry_5186=clip_geometry_5186,
        progress_callback=progress_callback,
        progress_label="당해년도",
        rgb_nodata_tolerance=rgb_nodata_tolerance,
    )

    warnings: list[PreflightWarning] = []
    warnings.extend(_footprint_method_warnings("과년도", standard))
    warnings.extend(_footprint_method_warnings("당해년도", compare))
    for label, item in (("과년도", standard), ("당해년도", compare)):
        warning = resolution_warning(label, item.mean_gsd_m, target_gsd_m=target_gsd_m)
        if warning is not None:
            warnings.append(warning)

    if standard.crs != compare.crs:
        warnings.append(
            PreflightWarning(
                code="CRS_TRANSFORM_APPLIED",
                severity="warning",
                message="과년도·당해년도 CRS가 달라 EPSG:5186으로 변환해 교차 영역을 계산합니다.",
                details={"standard_crs": standard.crs, "compare_crs": compare.crs},
            )
        )

    _emit_raster_progress(
        progress_callback,
        phase="fast_intersection",
        label="과년도·당해년도",
        path=None,
        polygon_count=2,
    )
    intersection = standard.footprint_5186.intersection(compare.footprint_5186)
    if intersection.is_empty or intersection.area <= 0:
        warnings.append(
            PreflightWarning(
                code="FOOTPRINT_INTERSECTION_EMPTY",
                severity="strong",
                message="EPSG:5186 변환 후 과년도·당해년도 영상 bounds 교차 영역이 없습니다.",
                details={},
            )
        )

    return PairPreflight(
        standard=standard,
        compare=compare,
        intersection_5186=intersection,
        target_gsd_m=target_gsd_m,
        warnings=warnings,
        overlap_method="fast_safe_bounds_pixel_mask",
    )


def build_pair_metadata(
    standard_path: str | Path,
    compare_path: str | Path,
    *,
    target_gsd_m: float = TARGET_GSD_M,
) -> PairPreflight:
    """Fast pair summary based on raster metadata and rectangular bounds only."""

    standard = analyze_raster_metadata(standard_path)
    compare = analyze_raster_metadata(compare_path)

    warnings: list[PreflightWarning] = []
    for label, item in (("과년도", standard), ("당해년도", compare)):
        warning = resolution_warning(label, item.mean_gsd_m, target_gsd_m=target_gsd_m)
        if warning is not None:
            warnings.append(warning)

    if standard.crs != compare.crs:
        warnings.append(
            PreflightWarning(
                code="CRS_TRANSFORM_APPLIED",
                severity="warning",
                message="과년도·당해년도 CRS가 달라 EPSG:5186으로 변환해 경계 중첩률을 계산합니다.",
                details={"standard_crs": standard.crs, "compare_crs": compare.crs},
            )
        )

    intersection = standard.footprint_5186.intersection(compare.footprint_5186)
    if intersection.is_empty or intersection.area <= 0:
        warnings.append(
            PreflightWarning(
                code="BOUNDS_INTERSECTION_EMPTY",
                severity="strong",
                message="EPSG:5186 변환 후 과년도·당해년도 영상 경계 교차 영역이 없습니다.",
                details={},
            )
        )

    return PairPreflight(
        standard=standard,
        compare=compare,
        intersection_5186=intersection,
        target_gsd_m=target_gsd_m,
        warnings=warnings,
        overlap_method="bounds",
    )


def resolution_warning(
    label: str,
    gsd_m: float,
    *,
    target_gsd_m: float = TARGET_GSD_M,
) -> PreflightWarning | None:
    if not math.isfinite(gsd_m) or gsd_m <= 0:
        return PreflightWarning(
            code="RESOLUTION_UNKNOWN",
            severity="strong",
            message=f"{label} 영상 해상도를 계산할 수 없습니다.",
            details={"gsd_m": gsd_m, "target_gsd_m": target_gsd_m},
        )

    diff_m = abs(gsd_m - target_gsd_m)
    if diff_m <= RESOLUTION_MATCH_TOLERANCE_M:
        return None

    diff_ratio = diff_m / target_gsd_m
    severity: WarningSeverity = (
        "strong" if diff_ratio > RESOLUTION_STRONG_WARNING_RATIO else "warning"
    )
    return PreflightWarning(
        code="RESOLUTION_DIFFERS_FROM_TRAINING_GSD",
        severity=severity,
        message=(
            f"{label} 영상 해상도({gsd_m:.2f} m)가 권장 해상도 "
            f"{target_gsd_m:.2f} m와 달라 결과 품질이 저하될 수 있습니다."
        ),
        details={
            "gsd_m": gsd_m,
            "target_gsd_m": target_gsd_m,
            "diff_ratio": diff_ratio,
        },
    )


def _footprint_method(
    src: rasterio.DatasetReader,
    *,
    rgb_nodata_rule: RgbNodataRule | None,
    rgb_nodata_sieve_pixels: int,
) -> str:
    if src.count >= 4:
        return "first_4_bands_nonzero"
    if rgb_nodata_rule is None:
        return "rgb_no_nodata_bounds"

    prefix = (
        "rgb_metadata_nodata"
        if rgb_nodata_rule.source == "metadata"
        else "rgb_inferred_nodata"
    )
    color = "_".join(str(value) for value in rgb_nodata_rule.color)
    method = f"{prefix}_{color}_tol_{int(rgb_nodata_rule.tolerance)}"
    if int(rgb_nodata_sieve_pixels) > 1:
        method = f"{method}_sieve_{int(rgb_nodata_sieve_pixels)}"
    return method


def _fast_safe_footprint_method(
    src: rasterio.DatasetReader,
    *,
    rgb_nodata_rule: RgbNodataRule | None,
) -> str:
    if rgb_nodata_rule is None:
        if _has_alpha_band(src):
            return "fast_bounds_pixel_mask_alpha"
        return "fast_bounds_pixel_mask_no_rgb_nodata"
    color = "_".join(str(value) for value in rgb_nodata_rule.color)
    return (
        f"fast_bounds_pixel_mask_{rgb_nodata_rule.source}_"
        f"{color}_tol_{int(rgb_nodata_rule.tolerance)}"
    )


def _has_alpha_band(src: rasterio.DatasetReader) -> bool:
    return any(
        interpretation == ColorInterp.alpha
        for interpretation in tuple(src.colorinterp or ())
    )


def _footprint_method_warnings(label: str, raster: RasterPreflight) -> list[PreflightWarning]:
    if raster.footprint_method.startswith("fast_bounds_pixel_mask"):
        return [
            PreflightWarning(
                code="FOOTPRINT_FAST_BOUNDS_PIXEL_MASK",
                severity="warning",
                message=(
                    f"{label} 영상은 대용량 안전 모드로 bounds 기준 chip을 만들고 "
                    "nodata는 픽셀 마스크 단계에서 제거합니다."
                ),
                details={
                    "path": raster.path,
                    "band_count": raster.band_count,
                    "footprint_method": raster.footprint_method,
                    "rgb_nodata_color": raster.rgb_nodata_color,
                    "rgb_nodata_tolerance": raster.rgb_nodata_tolerance,
                },
            )
        ]
    if raster.band_count >= 4:
        return []
    if raster.footprint_method.startswith("rgb_metadata_nodata"):
        return []
    if raster.footprint_method.startswith("rgb_inferred_nodata"):
        return [
            PreflightWarning(
                code="FOOTPRINT_RGB_INFERRED_NODATA",
                severity="warning",
                message=(
                    f"{label} 영상은 3밴드라 테두리 배경색을 nodata로 추정해 "
                    "footprint를 계산합니다."
                ),
                details={
                    "path": raster.path,
                    "band_count": raster.band_count,
                    "footprint_method": raster.footprint_method,
                },
            )
        ]
    return [
        PreflightWarning(
            code="FOOTPRINT_RGB_NO_NODATA_METADATA",
            severity="warning",
            message=(
                f"{label} 영상은 3밴드이고 alpha/nodata 정보를 찾지 못해 "
                "영상 전체 bounds를 footprint로 간주합니다."
            ),
            details={
                "path": raster.path,
                "band_count": raster.band_count,
                "footprint_method": raster.footprint_method,
            },
        )
    ]


def _valid_data_footprint(
    src: rasterio.DatasetReader,
    *,
    chunk_size: int,
    clip_geometry: BaseGeometry | None = None,
    progress_callback: RasterProgressCallback | None = None,
    progress_label: str,
    progress_path: str,
    progress_interval_s: float,
    rgb_nodata_rule: RgbNodataRule | None,
    rgb_nodata_sieve_pixels: int,
) -> tuple[BaseGeometry, int]:
    band_count = 4 if src.count >= 4 else 3
    if band_count == 3 and rgb_nodata_rule is None:
        footprint = _clip_if_needed(box(*_dataset_bounds(src)), clip_geometry)
        valid_pixel_count = _bounds_valid_pixel_count(src, footprint)
        _emit_raster_progress(
            progress_callback,
            phase="bounds",
            label=progress_label,
            path=progress_path,
            window_index=1,
            window_count=1,
            valid_pixel_count=valid_pixel_count,
            polygon_count=1 if not footprint.is_empty else 0,
            band_count=band_count,
            rgb_nodata_color=None,
            rgb_nodata_tolerance=None,
        )
        _emit_raster_progress(
            progress_callback,
            phase="done",
            label=progress_label,
            path=progress_path,
            window_index=1,
            window_count=1,
            valid_pixel_count=valid_pixel_count,
            polygon_count=1 if not footprint.is_empty else 0,
            band_count=band_count,
            rgb_nodata_color=None,
            rgb_nodata_tolerance=None,
        )
        return footprint, valid_pixel_count

    indexes = tuple(range(1, band_count + 1))
    polygons: list[BaseGeometry] = []
    valid_pixel_count = 0
    should_sieve_rgb_nodata_noise = (
        band_count == 3
        and rgb_nodata_rule is not None
        and int(rgb_nodata_sieve_pixels) > 1
    )

    scan_window = _scan_window_for_geometry(src, clip_geometry)
    windows = list(
        _iter_windows(src.width, src.height, chunk_size, scan_window=scan_window)
    )
    total_windows = len(windows)
    last_progress_at = 0.0
    full_run_bounds: tuple[float, float, float, float] | None = None
    full_run_row: int | None = None

    def flush_full_run() -> None:
        nonlocal full_run_bounds, full_run_row
        if full_run_bounds is not None:
            polygons.append(box(*full_run_bounds))
            full_run_bounds = None
            full_run_row = None

    def emit_window_progress(
        *,
        phase: str,
        window_index: int,
        force: bool = False,
        polygon_count: int | None = None,
    ) -> None:
        nonlocal last_progress_at
        now = time.monotonic()
        if not force and now - last_progress_at < max(0.1, progress_interval_s):
            return
        last_progress_at = now
        _emit_raster_progress(
            progress_callback,
            phase=phase,
            label=progress_label,
            path=progress_path,
            window_index=window_index,
            window_count=total_windows,
            valid_pixel_count=valid_pixel_count,
            polygon_count=len(polygons) if polygon_count is None else polygon_count,
            band_count=band_count,
            rgb_nodata_color=(
                rgb_nodata_rule.color if rgb_nodata_rule is not None else None
            ),
            rgb_nodata_tolerance=(
                rgb_nodata_rule.tolerance if rgb_nodata_rule is not None else None
            ),
        )

    emit_window_progress(phase="scan", window_index=0, force=True, polygon_count=0)
    for window_index, window in enumerate(windows, start=1):
        window_geom = box(*window_bounds(window, src.transform))
        if clip_geometry is not None and not window_geom.intersects(clip_geometry):
            continue
        emit_window_progress(phase="scan", window_index=window_index)
        data = src.read(indexes=indexes, window=window)
        if band_count == 3 and rgb_nodata_rule is not None:
            valid = _rgb_valid_mask(data, rgb_nodata_rule)
        else:
            valid = np.any(data != 0, axis=0)
        count = int(valid.sum())
        if should_sieve_rgb_nodata_noise and 0 < count < valid.size:
            valid = _fill_tiny_invalid_regions(
                valid,
                min_region_pixels=rgb_nodata_sieve_pixels,
            )
            count = int(valid.sum())
        if count == 0:
            flush_full_run()
            continue
        valid_pixel_count += count

        if count == valid.size:
            can_merge_run = clip_geometry is None or clip_geometry.contains(window_geom)
            if can_merge_run:
                bounds = window_geom.bounds
                if (
                    full_run_bounds is not None
                    and full_run_row == int(window.row_off)
                    and abs(bounds[0] - full_run_bounds[2]) <= 1e-9
                    and abs(bounds[1] - full_run_bounds[1]) <= 1e-9
                    and abs(bounds[3] - full_run_bounds[3]) <= 1e-9
                ):
                    full_run_bounds = (
                        full_run_bounds[0],
                        full_run_bounds[1],
                        bounds[2],
                        full_run_bounds[3],
                    )
                else:
                    flush_full_run()
                    full_run_bounds = bounds
                    full_run_row = int(window.row_off)
            else:
                flush_full_run()
                polygons.append(_clip_if_needed(window_geom, clip_geometry))
            continue

        flush_full_run()
        mask = valid.astype(np.uint8)
        transform_for_window = src.window_transform(window)
        emit_window_progress(phase="polygonize", window_index=window_index, force=True)
        for geom, value in shapes(mask, mask=valid, transform=transform_for_window):
            if int(value) == 1:
                polygons.append(_clip_if_needed(shape(geom), clip_geometry))

    flush_full_run()
    if not polygons:
        return box(0, 0, 0, 0).intersection(box(1, 1, 1, 1)), 0

    _emit_raster_progress(
        progress_callback,
        phase="union",
        label=progress_label,
        path=progress_path,
        window_index=total_windows,
        window_count=total_windows,
        valid_pixel_count=valid_pixel_count,
        polygon_count=len(polygons),
        band_count=band_count,
        rgb_nodata_color=(
            rgb_nodata_rule.color if rgb_nodata_rule is not None else None
        ),
        rgb_nodata_tolerance=(
            rgb_nodata_rule.tolerance if rgb_nodata_rule is not None else None
        ),
    )
    footprint = unary_union(polygons)
    _emit_raster_progress(
        progress_callback,
        phase="done",
        label=progress_label,
        path=progress_path,
        window_index=total_windows,
        window_count=total_windows,
        valid_pixel_count=valid_pixel_count,
        polygon_count=len(polygons),
        band_count=band_count,
        rgb_nodata_color=(
            rgb_nodata_rule.color if rgb_nodata_rule is not None else None
        ),
        rgb_nodata_tolerance=(
            rgb_nodata_rule.tolerance if rgb_nodata_rule is not None else None
        ),
    )
    return footprint, valid_pixel_count


def _emit_raster_progress(
    progress_callback: RasterProgressCallback | None,
    **event: Any,
) -> None:
    if progress_callback is None:
        return
    progress_callback(event)


def _geometry_wkb_size(geom: BaseGeometry) -> int:
    if geom.is_empty:
        return 0
    return len(wkb.dumps(geom, hex=False))


def _with_bounds_fallback_footprint(raster: RasterPreflight) -> RasterPreflight:
    return replace(
        raster,
        footprint_5186=raster.footprint_5186.envelope,
        footprint_method=f"{raster.footprint_method}_bounds_fallback",
    )


def _raster_preflight_cache_path(
    src: rasterio.DatasetReader,
    raster_path: Path,
    *,
    cache_dir: str | Path | None,
    chunk_size: int,
    clip_geometry: BaseGeometry | None,
    rgb_nodata_rule: RgbNodataRule | None,
    rgb_nodata_tolerance: int,
    rgb_nodata_sieve_pixels: int,
) -> Path | None:
    if cache_dir is None:
        return None
    try:
        stat = raster_path.stat()
    except OSError:
        return None
    clip_hash = None
    if clip_geometry is not None and not clip_geometry.is_empty:
        clip_hash = hashlib.sha256(wkb.dumps(clip_geometry, hex=False)).hexdigest()
    payload = {
        "version": RASTER_PREFLIGHT_CACHE_VERSION,
        "path": str(raster_path.resolve()),
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
        "width": int(src.width),
        "height": int(src.height),
        "count": int(src.count),
        "crs": src.crs.to_string() if src.crs else None,
        "transform": tuple(float(v) for v in src.transform.to_gdal()),
        "dtypes": tuple(str(dtype) for dtype in src.dtypes),
        "nodata": src.nodata,
        "chunk_size": int(chunk_size),
        "clip_geometry_sha256": clip_hash,
        "rgb_nodata_color": (
            rgb_nodata_rule.color if rgb_nodata_rule is not None else None
        ),
        "rgb_nodata_source": (
            rgb_nodata_rule.source if rgb_nodata_rule is not None else None
        ),
        "rgb_nodata_tolerance": int(rgb_nodata_tolerance),
        "rgb_nodata_sieve_pixels": int(rgb_nodata_sieve_pixels),
    }
    key = hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return Path(cache_dir) / f"{key}.json"


def _read_cached_raster_preflight(cache_path: Path) -> RasterPreflight | None:
    try:
        payload = json.loads(cache_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if payload.get("version") != RASTER_PREFLIGHT_CACHE_VERSION:
        return None
    try:
        footprint = wkb.loads(str(payload["footprint_wkb_hex"]), hex=True)
        return RasterPreflight(
            path=str(payload["path"]),
            crs=str(payload["crs"]),
            width=int(payload["width"]),
            height=int(payload["height"]),
            band_count=int(payload["band_count"]),
            gsd_x_m=float(payload["gsd_x_m"]),
            gsd_y_m=float(payload["gsd_y_m"]),
            footprint_5186=footprint,
            footprint_method=str(payload["footprint_method"]),
            valid_pixel_count=int(payload["valid_pixel_count"]),
            rgb_nodata_color=(
                tuple(int(value) for value in payload["rgb_nodata_color"])
                if payload.get("rgb_nodata_color") is not None
                else None
            ),
            rgb_nodata_tolerance=(
                int(payload["rgb_nodata_tolerance"])
                if payload.get("rgb_nodata_tolerance") is not None
                else None
            ),
            rgb_nodata_source=(
                str(payload["rgb_nodata_source"])
                if payload.get("rgb_nodata_source") is not None
                else None
            ),
        )
    except (KeyError, TypeError, ValueError):
        return None


def _write_cached_raster_preflight(
    cache_path: Path,
    raster: RasterPreflight,
) -> None:
    payload = {
        "version": RASTER_PREFLIGHT_CACHE_VERSION,
        "path": raster.path,
        "crs": raster.crs,
        "width": raster.width,
        "height": raster.height,
        "band_count": raster.band_count,
        "gsd_x_m": raster.gsd_x_m,
        "gsd_y_m": raster.gsd_y_m,
        "footprint_wkb_hex": wkb.dumps(raster.footprint_5186, hex=True),
        "footprint_method": raster.footprint_method,
        "valid_pixel_count": raster.valid_pixel_count,
        "rgb_nodata_color": raster.rgb_nodata_color,
        "rgb_nodata_tolerance": raster.rgb_nodata_tolerance,
        "rgb_nodata_source": raster.rgb_nodata_source,
    }
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = cache_path.with_name(f"{cache_path.name}.{os.getpid()}.tmp")
        tmp_path.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        os.replace(tmp_path, cache_path)
    except OSError as exc:
        print(f"[raster-preflight-cache] write failed path={cache_path}: {exc}", flush=True)


def _rgb_nodata_rule(
    src: rasterio.DatasetReader,
    *,
    tolerance: int,
) -> RgbNodataRule | None:
    if src.count < 3:
        return None

    metadata_color = _rgb_metadata_nodata_color(src)
    if metadata_color is not None:
        return RgbNodataRule(color=metadata_color, source="metadata", tolerance=0)

    if src.count != 3:
        return None

    inferred_color = _infer_rgb_edge_nodata_color(src, tolerance=tolerance)
    if inferred_color is None:
        return None
    return RgbNodataRule(
        color=inferred_color,
        source="inferred_edge",
        tolerance=max(0, int(tolerance)),
    )


def _rgb_metadata_nodata_color(src: rasterio.DatasetReader) -> tuple[int, int, int] | None:
    values = list((src.nodatavals or ())[:3])
    if len(values) < 3 and src.nodata is not None:
        values = [src.nodata, src.nodata, src.nodata]
    if len(values) < 3 or any(value is None for value in values):
        return None

    color: list[int] = []
    for value in values:
        numeric = float(value)
        if not math.isfinite(numeric):
            return None
        rounded = int(round(numeric))
        if abs(numeric - rounded) > 1e-6:
            return None
        color.append(rounded)
    return (color[0], color[1], color[2])


def _infer_rgb_edge_nodata_color(
    src: rasterio.DatasetReader,
    *,
    tolerance: int,
) -> tuple[int, int, int] | None:
    if src.count != 3:
        return None
    if not all(np.dtype(dtype) == np.dtype("uint8") for dtype in src.dtypes[:3]):
        return None

    samples = _rgb_edge_samples(src)
    if samples.size == 0:
        return None

    tol = max(0, int(tolerance))
    samples_i = samples.astype(np.int16, copy=False)
    black_ratio = float(np.all(samples_i <= tol, axis=0).mean())
    white_ratio = float(np.all(samples_i >= 255 - tol, axis=0).mean())
    if max(black_ratio, white_ratio) < RGB_NODATA_MIN_EDGE_RATIO:
        return None
    if white_ratio >= black_ratio:
        return (255, 255, 255)
    return (0, 0, 0)


def _rgb_edge_samples(src: rasterio.DatasetReader) -> np.ndarray:
    sample_width = min(RGB_NODATA_SAMPLE_PIXELS, int(src.width))
    sample_height = min(RGB_NODATA_SAMPLE_PIXELS, int(src.height))
    if sample_width <= 0 or sample_height <= 0:
        return np.empty((3, 0), dtype=np.uint8)

    col_positions = [
        0,
        max(0, (int(src.width) - sample_width) // 2),
        max(0, int(src.width) - sample_width),
    ]
    row_positions = [
        0,
        max(0, (int(src.height) - sample_height) // 2),
        max(0, int(src.height) - sample_height),
    ]
    windows: list[Window] = []
    for col in col_positions:
        windows.append(Window(col, 0, sample_width, sample_height))
        windows.append(
            Window(col, int(src.height) - sample_height, sample_width, sample_height)
        )
    for row in row_positions:
        windows.append(Window(0, row, sample_width, sample_height))
        windows.append(
            Window(int(src.width) - sample_width, row, sample_width, sample_height)
        )
    samples: list[np.ndarray] = []
    seen: set[tuple[int, int, int, int]] = set()
    for window in windows:
        key = (
            int(window.col_off),
            int(window.row_off),
            int(window.width),
            int(window.height),
        )
        if key in seen:
            continue
        seen.add(key)
        data = src.read(indexes=(1, 2, 3), window=window)
        samples.append(data.reshape(3, -1))
    if not samples:
        return np.empty((3, 0), dtype=np.uint8)
    return np.concatenate(samples, axis=1)


def _rgb_valid_mask(data: np.ndarray, rule: RgbNodataRule) -> np.ndarray:
    reference = np.asarray(rule.color, dtype=np.int32)[:, np.newaxis, np.newaxis]
    data_i = data.astype(np.int32, copy=False)
    if int(rule.tolerance) <= 0:
        invalid = np.all(data_i == reference, axis=0)
    else:
        invalid = np.all(np.abs(data_i - reference) <= int(rule.tolerance), axis=0)
    return np.logical_not(invalid)


def _bounds_valid_pixel_count(src: rasterio.DatasetReader, footprint: BaseGeometry) -> int:
    if footprint.is_empty:
        return 0
    pixel_area = abs(
        float(src.transform.a * src.transform.e - src.transform.b * src.transform.d)
    )
    if pixel_area > 0:
        return max(0, int(round(float(footprint.area) / pixel_area)))
    return int(src.width) * int(src.height)


def _fill_tiny_invalid_regions(
    valid: np.ndarray,
    *,
    min_region_pixels: int,
) -> np.ndarray:
    """Fill tiny RGB nodata-color regions without removing original valid pixels."""

    if int(min_region_pixels) <= 1 or valid.size == 0:
        return valid
    if int(min_region_pixels) >= valid.size:
        return valid
    sieved = sieve(valid.astype(np.uint8), size=int(min_region_pixels), connectivity=8)
    return np.logical_or(valid, sieved.astype(bool))


def _iter_windows(
    width: int,
    height: int,
    chunk_size: int,
    *,
    scan_window: Window | None = None,
) -> Iterator[Window]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    if scan_window is None:
        col_start, row_start, col_stop, row_stop = 0, 0, width, height
    else:
        col_start = max(0, int(math.floor(scan_window.col_off)))
        row_start = max(0, int(math.floor(scan_window.row_off)))
        col_stop = min(width, int(math.ceil(scan_window.col_off + scan_window.width)))
        row_stop = min(height, int(math.ceil(scan_window.row_off + scan_window.height)))
    for row_off in range(row_start, row_stop, chunk_size):
        for col_off in range(col_start, col_stop, chunk_size):
            yield Window(
                col_off=col_off,
                row_off=row_off,
                width=min(chunk_size, col_stop - col_off),
                height=min(chunk_size, row_stop - row_off),
            )


def _estimate_gsd_m(src: rasterio.DatasetReader) -> tuple[float, float]:
    transformer = Transformer.from_crs(src.crs, "EPSG:4326", always_xy=True)
    geod = Geod(ellps="WGS84")
    cx = src.width / 2.0
    cy = src.height / 2.0
    x0, y0 = src.transform * (cx, cy)
    x1, y1 = src.transform * (cx + 1.0, cy)
    x2, y2 = src.transform * (cx, cy + 1.0)
    lon0, lat0 = transformer.transform(x0, y0)
    lon1, lat1 = transformer.transform(x1, y1)
    lon2, lat2 = transformer.transform(x2, y2)
    _, _, dist_x = geod.inv(lon0, lat0, lon1, lat1)
    _, _, dist_y = geod.inv(lon0, lat0, lon2, lat2)
    return abs(float(dist_x)), abs(float(dist_y))


def _to_5186(geom: BaseGeometry, src_crs: Any) -> BaseGeometry:
    if geom.is_empty:
        return geom
    src_text = src_crs.to_string() if hasattr(src_crs, "to_string") else str(src_crs)
    src_epsg = src_crs.to_epsg() if hasattr(src_crs, "to_epsg") else None
    if src_epsg == 5186 or src_text == TARGET_CRS:
        return geom
    transformer = Transformer.from_crs(src_crs, TARGET_CRS, always_xy=True)
    return transform(transformer.transform, geom)


def _from_5186(geom: BaseGeometry, dst_crs: Any) -> BaseGeometry:
    if geom.is_empty:
        return geom
    dst_text = dst_crs.to_string() if hasattr(dst_crs, "to_string") else str(dst_crs)
    dst_epsg = dst_crs.to_epsg() if hasattr(dst_crs, "to_epsg") else None
    if dst_epsg == 5186 or dst_text == TARGET_CRS:
        return geom
    transformer = Transformer.from_crs(TARGET_CRS, dst_crs, always_xy=True)
    return transform(transformer.transform, geom)


def _dataset_bounds(dataset: Any) -> tuple[float, float, float, float]:
    bounds = dataset.bounds
    return (float(bounds.left), float(bounds.bottom), float(bounds.right), float(bounds.top))


def _scan_window_for_geometry(
    src: rasterio.DatasetReader,
    clip_geometry: BaseGeometry | None,
) -> Window | None:
    if clip_geometry is None or clip_geometry.is_empty:
        return None
    raw = from_bounds(*clip_geometry.bounds, transform=src.transform)
    col_start = max(0, math.floor(raw.col_off - 1))
    row_start = max(0, math.floor(raw.row_off - 1))
    col_stop = min(src.width, math.ceil(raw.col_off + raw.width + 1))
    row_stop = min(src.height, math.ceil(raw.row_off + raw.height + 1))
    if col_stop <= col_start or row_stop <= row_start:
        return Window(0, 0, 0, 0)
    return Window(
        col_off=col_start,
        row_off=row_start,
        width=col_stop - col_start,
        height=row_stop - row_start,
    )


def _clip_if_needed(geom: BaseGeometry, clip_geometry: BaseGeometry | None) -> BaseGeometry:
    if clip_geometry is None:
        return geom
    if geom.within(clip_geometry):
        return geom
    return geom.intersection(clip_geometry)
