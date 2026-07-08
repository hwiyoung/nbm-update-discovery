"""Build per-sheet chip manifests for large-raster change detection.

The manifest is a planning artifact only.  It does not write rasters or alter
the current legacy engine path; later phases will use it to create sheet-level
T1/T2 chips.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Iterable

from shapely import wkb
from shapely.geometry.base import BaseGeometry

from app.services.raster_preflight import PairPreflight, TARGET_CRS, TARGET_GSD_M


DEFAULT_SHEET_BUFFER_M = 32.0
MIN_CORE_AREA_M2 = 1.0


@dataclass(frozen=True)
class SheetGeometry:
    code: str
    geometry_5186: BaseGeometry


@dataclass(frozen=True)
class ChipGrid:
    bounds_5186: tuple[float, float, float, float]
    width: int
    height: int
    target_gsd_m: float

    @property
    def pixel_count(self) -> int:
        return self.width * self.height


@dataclass(frozen=True)
class SheetChip:
    sheet_code: str
    core_geometry_5186: BaseGeometry
    read_geometry_5186: BaseGeometry
    core_area_m2: float
    read_area_m2: float
    buffer_m: float
    grid: ChipGrid


@dataclass(frozen=True)
class SkippedSheet:
    sheet_code: str
    reason: str


@dataclass(frozen=True)
class SheetChipManifest:
    target_crs: str
    target_gsd_m: float
    buffer_m: float
    chips: list[SheetChip] = field(default_factory=list)
    skipped_sheets: list[SkippedSheet] = field(default_factory=list)

    @property
    def total_pixels(self) -> int:
        return sum(chip.grid.pixel_count for chip in self.chips)


def build_sheet_chip_manifest(
    pair: PairPreflight,
    sheets: Iterable[Any],
    *,
    buffer_m: float = DEFAULT_SHEET_BUFFER_M,
    target_gsd_m: float = TARGET_GSD_M,
    min_core_area_m2: float = MIN_CORE_AREA_M2,
) -> SheetChipManifest:
    """Create one chip plan per sheet intersecting the actual T1/T2 footprint.

    ``core_geometry`` is the final area to keep.  ``read_geometry`` includes
    buffer and stays clipped to the actual T1/T2 footprint intersection.
    """

    if buffer_m < 0:
        raise ValueError("buffer_m must be non-negative")
    if target_gsd_m <= 0:
        raise ValueError("target_gsd_m must be positive")

    chips: list[SheetChip] = []
    skipped: list[SkippedSheet] = []
    intersection = pair.intersection_5186
    if intersection.is_empty or intersection.area <= 0:
        return SheetChipManifest(
            target_crs=TARGET_CRS,
            target_gsd_m=target_gsd_m,
            buffer_m=buffer_m,
            skipped_sheets=[
                SkippedSheet(sheet_code=_sheet_code(sheet), reason="empty_pair_intersection")
                for sheet in sheets
            ],
        )

    for raw_sheet in sheets:
        sheet = coerce_sheet_geometry(raw_sheet)
        core = sheet.geometry_5186.intersection(intersection)
        if core.is_empty or core.area < min_core_area_m2:
            skipped.append(SkippedSheet(sheet.code, "no_core_intersection"))
            continue

        read = core.buffer(buffer_m).intersection(intersection)
        if read.is_empty or read.area < min_core_area_m2:
            skipped.append(SkippedSheet(sheet.code, "no_read_intersection"))
            continue

        grid = _grid_for_bounds(read.bounds, target_gsd_m)
        chips.append(
            SheetChip(
                sheet_code=sheet.code,
                core_geometry_5186=core,
                read_geometry_5186=read,
                core_area_m2=float(core.area),
                read_area_m2=float(read.area),
                buffer_m=buffer_m,
                grid=grid,
            )
        )

    chips.sort(key=lambda chip: chip.sheet_code)
    skipped.sort(key=lambda item: item.sheet_code)
    return SheetChipManifest(
        target_crs=TARGET_CRS,
        target_gsd_m=target_gsd_m,
        buffer_m=buffer_m,
        chips=chips,
        skipped_sheets=skipped,
    )


def coerce_sheet_geometry(sheet: Any) -> SheetGeometry:
    code = _sheet_code(sheet)
    geometry = getattr(sheet, "geometry_5186", None)
    if geometry is None:
        geometry = getattr(sheet, "geometry", None)
    if geometry is None:
        raise ValueError(f"sheet has no geometry: {code}")
    if isinstance(geometry, BaseGeometry):
        return SheetGeometry(code=code, geometry_5186=geometry)
    return SheetGeometry(code=code, geometry_5186=_wkb_to_geometry(geometry))


def _sheet_code(sheet: Any) -> str:
    code = getattr(sheet, "code", None)
    if code is None and isinstance(sheet, dict):
        code = sheet.get("code")
    if not code:
        raise ValueError("sheet code is required")
    return str(code)


def _wkb_to_geometry(value: Any) -> BaseGeometry:
    raw = getattr(value, "desc", value)
    if isinstance(raw, str):
        return wkb.loads(bytes.fromhex(raw))
    return wkb.loads(raw)


def _grid_for_bounds(
    bounds_5186: tuple[float, float, float, float],
    target_gsd_m: float,
) -> ChipGrid:
    left, bottom, right, top = _align_bounds(bounds_5186, target_gsd_m)
    width = max(1, int(round((right - left) / target_gsd_m)))
    height = max(1, int(round((top - bottom) / target_gsd_m)))
    return ChipGrid(
        bounds_5186=(left, bottom, right, top),
        width=width,
        height=height,
        target_gsd_m=target_gsd_m,
    )


def _align_bounds(
    bounds_5186: tuple[float, float, float, float],
    target_gsd_m: float,
) -> tuple[float, float, float, float]:
    minx, miny, maxx, maxy = bounds_5186
    left = math.floor(minx / target_gsd_m) * target_gsd_m
    bottom = math.floor(miny / target_gsd_m) * target_gsd_m
    right = math.ceil(maxx / target_gsd_m) * target_gsd_m
    top = math.ceil(maxy / target_gsd_m) * target_gsd_m
    return (left, bottom, right, top)
