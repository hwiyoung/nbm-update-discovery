"""Write per-sheet T1/T2 GeoTIFF chips from a sheet chip manifest."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np
import rasterio
from rasterio.enums import ColorInterp
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT

from app.services.raster_preflight import PairPreflight, RasterPreflight, TARGET_CRS
from app.services.sheet_chip_manifest import SheetChip, SheetChipManifest, SkippedSheet


DEFAULT_RESAMPLING = "cubic"
DEFAULT_PREFILTER_MAX_SAMPLE_PIXELS = 262_144
DEFAULT_PREFILTER_MIN_VALID_RATIO = 0.0


@dataclass(frozen=True)
class WrittenSheetChip:
    sheet_code: str
    t1_path: Path
    t2_path: Path
    valid_mask_path: Path
    width: int
    height: int
    bounds_5186: tuple[float, float, float, float]
    target_gsd_m: float
    t1_valid_pixel_count: int = 0
    t2_valid_pixel_count: int = 0
    common_valid_pixel_count: int = 0


@dataclass(frozen=True)
class SheetValidSample:
    sheet_code: str
    core_sample_pixel_count: int
    common_valid_sample_pixel_count: int
    common_valid_ratio: float
    sample_width: int
    sample_height: int


def filter_manifest_by_common_valid_data(
    pair: PairPreflight,
    manifest: SheetChipManifest,
    *,
    max_sample_pixels: int = DEFAULT_PREFILTER_MAX_SAMPLE_PIXELS,
    min_valid_ratio: float = DEFAULT_PREFILTER_MIN_VALID_RATIO,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
) -> SheetChipManifest:
    """Drop sheets that have no sampled T1/T2 common valid pixels before full chip writing.

    The exact valid mask is still computed during chip writing.  This prefilter
    only avoids spending full-resolution resampling time on sheets that are
    clearly all nodata in either source.
    """

    if not manifest.chips:
        return manifest
    max_sample_pixels = max(1, int(max_sample_pixels))
    min_valid_ratio = min(1.0, max(0.0, float(min_valid_ratio)))
    kept: list[SheetChip] = []
    skipped = list(manifest.skipped_sheets)
    total = len(manifest.chips)
    for index, chip in enumerate(manifest.chips, start=1):
        sample = _sample_common_valid_data(
            pair,
            chip,
            max_sample_pixels=max_sample_pixels,
        )
        should_skip = (
            sample.core_sample_pixel_count <= 0
            or sample.common_valid_sample_pixel_count <= 0
            or sample.common_valid_ratio < min_valid_ratio
        )
        if should_skip:
            if sample.core_sample_pixel_count <= 0:
                reason = "no_core_sample_pixels_prefilter"
            elif sample.common_valid_sample_pixel_count <= 0:
                reason = "no_common_valid_pixels_prefilter"
            else:
                reason = "low_common_valid_ratio_prefilter"
            skipped.append(SkippedSheet(chip.sheet_code, reason))
        else:
            kept.append(chip)
        if progress_callback is not None:
            progress_callback(
                {
                    "sheet_code": chip.sheet_code,
                    "sheet_index": index,
                    "sheet_count": total,
                    "sample_width": sample.sample_width,
                    "sample_height": sample.sample_height,
                    "core_sample_pixel_count": sample.core_sample_pixel_count,
                    "common_valid_sample_pixel_count": sample.common_valid_sample_pixel_count,
                    "common_valid_ratio": sample.common_valid_ratio,
                    "skipped": should_skip,
                    "skip_reason": reason if should_skip else None,
                }
            )
    skipped.sort(key=lambda item: item.sheet_code)
    return SheetChipManifest(
        target_crs=manifest.target_crs,
        target_gsd_m=manifest.target_gsd_m,
        buffer_m=manifest.buffer_m,
        chips=kept,
        skipped_sheets=skipped,
    )


def write_sheet_chips(
    pair: PairPreflight,
    manifest: SheetChipManifest,
    output_root: str | Path,
    *,
    resampling: str = DEFAULT_RESAMPLING,
    max_chips: int | None = None,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
) -> list[WrittenSheetChip]:
    """Write T1/T2 chips for each manifest item.

    Files are written to ``output_root/T1/{sheet_code}.tif`` and
    ``output_root/T2/{sheet_code}.tif``.  Reads and writes are block-windowed so
    large chips do not require loading the whole chip into memory.
    """

    root = Path(output_root)
    t1_dir = root / "T1"
    t2_dir = root / "T2"
    mask_dir = root / "_valid_masks"
    t1_mask_tmp_dir = mask_dir / "_T1"
    t2_mask_tmp_dir = mask_dir / "_T2"
    t1_dir.mkdir(parents=True, exist_ok=True)
    t2_dir.mkdir(parents=True, exist_ok=True)
    mask_dir.mkdir(parents=True, exist_ok=True)
    t1_mask_tmp_dir.mkdir(parents=True, exist_ok=True)
    t2_mask_tmp_dir.mkdir(parents=True, exist_ok=True)

    selected = manifest.chips if max_chips is None else manifest.chips[:max_chips]
    written: list[WrittenSheetChip] = []
    resampling_enum = _resampling(resampling)
    total_units = max(1, len(selected) * 2)
    for chip_index, chip in enumerate(selected, start=1):
        t1_path = t1_dir / f"{chip.sheet_code}.tif"
        t2_path = t2_dir / f"{chip.sheet_code}.tif"
        t1_mask_path = t1_mask_tmp_dir / f"{chip.sheet_code}.tif"
        t2_mask_path = t2_mask_tmp_dir / f"{chip.sheet_code}.tif"
        valid_mask_path = mask_dir / f"{chip.sheet_code}.tif"
        t1_valid_pixel_count = _write_one_source_chip(
            source=pair.standard,
            chip=chip,
            output_path=t1_path,
            mask_output_path=t1_mask_path,
            resampling=resampling_enum,
            source_label="T1",
            current_step=((chip_index - 1) * 2) + 1,
            total_step=total_units,
            chip_index=chip_index,
            chip_count=len(selected),
            progress_callback=progress_callback,
        )
        t2_valid_pixel_count = _write_one_source_chip(
            source=pair.compare,
            chip=chip,
            output_path=t2_path,
            mask_output_path=t2_mask_path,
            resampling=resampling_enum,
            source_label="T2",
            current_step=((chip_index - 1) * 2) + 2,
            total_step=total_units,
            chip_index=chip_index,
            chip_count=len(selected),
            progress_callback=progress_callback,
        )
        common_valid_pixel_count = 0
        if t1_valid_pixel_count > 0 and t2_valid_pixel_count > 0:
            common_valid_pixel_count = _write_common_valid_mask(
                t1_mask_path,
                t2_mask_path,
                valid_mask_path,
            )
        if (
            t1_valid_pixel_count <= 0
            or t2_valid_pixel_count <= 0
            or common_valid_pixel_count <= 0
        ):
            for path in (t1_path, t2_path, t1_mask_path, t2_mask_path, valid_mask_path):
                if path.exists():
                    path.unlink()
            if progress_callback is not None:
                progress_callback(
                    {
                        "sheet_code": chip.sheet_code,
                        "source": "T1/T2",
                        "current_step": chip_index * 2,
                        "total_step": total_units,
                        "chip_index": chip_index,
                        "chip_count": len(selected),
                        "skipped": True,
                        "skip_reason": "empty_valid_pixels_after_nodata_mask",
                        "t1_valid_pixel_count": t1_valid_pixel_count,
                        "t2_valid_pixel_count": t2_valid_pixel_count,
                        "common_valid_pixel_count": common_valid_pixel_count,
                    }
                )
            continue
        for path in (t1_mask_path, t2_mask_path):
            if path.exists():
                path.unlink()
        written.append(
            WrittenSheetChip(
                sheet_code=chip.sheet_code,
                t1_path=t1_path,
                t2_path=t2_path,
                valid_mask_path=valid_mask_path,
                width=chip.grid.width,
                height=chip.grid.height,
                bounds_5186=chip.grid.bounds_5186,
                target_gsd_m=chip.grid.target_gsd_m,
                t1_valid_pixel_count=t1_valid_pixel_count,
                t2_valid_pixel_count=t2_valid_pixel_count,
                common_valid_pixel_count=common_valid_pixel_count,
            )
        )
    for tmp_dir in (t1_mask_tmp_dir, t2_mask_tmp_dir):
        try:
            tmp_dir.rmdir()
        except OSError:
            pass
    return written


def _write_one_source_chip(
    *,
    source: RasterPreflight,
    chip: SheetChip,
    output_path: Path,
    mask_output_path: Path,
    resampling: Resampling,
    source_label: str,
    current_step: int,
    total_step: int,
    chip_index: int,
    chip_count: int,
    progress_callback: Callable[[dict[str, Any]], None] | None,
) -> int:
    left, bottom, right, top = chip.grid.bounds_5186
    transform = from_origin(left, top, chip.grid.target_gsd_m, chip.grid.target_gsd_m)
    width = chip.grid.width
    height = chip.grid.height

    output_path.parent.mkdir(parents=True, exist_ok=True)
    mask_output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        output_path.unlink()
    if mask_output_path.exists():
        mask_output_path.unlink()

    with rasterio.open(source.path) as src:
        if src.count < 3:
            raise ValueError(f"source raster must have at least 3 bands: {source.path}")
        dtype = src.dtypes[0]
        profile = src.profile.copy()
        profile.update(
            driver="GTiff",
            height=height,
            width=width,
            count=3,
            dtype=dtype,
            crs=TARGET_CRS,
            transform=transform,
            nodata=0,
            tiled=True,
            blockxsize=_tile_size(width),
            blockysize=_tile_size(height),
            compress="lzw",
            BIGTIFF="IF_SAFER",
        )
        mask_profile = profile.copy()
        mask_profile.update(
            count=1,
            dtype="uint8",
            nodata=0,
            compress="lzw",
            BIGTIFF="IF_SAFER",
        )

        with WarpedVRT(
            src,
            crs=TARGET_CRS,
            transform=transform,
            width=width,
            height=height,
            src_nodata=src.nodata,
            nodata=0,
            resampling=resampling,
        ) as vrt, rasterio.open(output_path, "w", **profile) as dst, rasterio.open(
            mask_output_path,
            "w",
            **mask_profile,
        ) as mask_dst:
            windows = list(dst.block_windows(1))
            total_blocks = max(1, len(windows))
            notify_every = max(1, total_blocks // 20)
            valid_pixel_count = 0
            alpha_index = _alpha_band_index(src)
            for block_index, (_, window) in enumerate(windows, start=1):
                if (
                    progress_callback is not None
                    and (
                        block_index == 1
                        or block_index == total_blocks
                        or block_index % notify_every == 0
                    )
                ):
                    progress_callback(
                        {
                            "sheet_code": chip.sheet_code,
                            "source": source_label,
                            "current_step": current_step,
                            "total_step": total_step,
                            "chip_index": chip_index,
                            "chip_count": chip_count,
                            "block_index": block_index,
                            "block_count": total_blocks,
                            "width": width,
                            "height": height,
                            "target_gsd_m": chip.grid.target_gsd_m,
                            "rgb_nodata_color": source.rgb_nodata_color,
                            "rgb_nodata_tolerance": source.rgb_nodata_tolerance,
                        }
                )
                out_height = int(window.height)
                out_width = int(window.width)
                data = vrt.read(indexes=(1, 2, 3), window=window, out_dtype=dtype)
                mask = rasterize(
                    [(chip.read_geometry_5186, 1)],
                    out_shape=(out_height, out_width),
                    transform=dst.window_transform(window),
                    fill=0,
                    dtype=np.uint8,
                    all_touched=True,
                )
                valid_mask = mask.astype(bool)
                valid_mask &= vrt.read_masks(1, window=window) > 0
                if source.rgb_nodata_color is not None:
                    valid_mask &= _rgb_valid_mask(
                        data,
                        color=source.rgb_nodata_color,
                        tolerance=source.rgb_nodata_tolerance or 0,
                    )
                if alpha_index is not None:
                    alpha = vrt.read(alpha_index, window=window)
                    valid_mask &= alpha > 0
                valid_pixel_count += int(valid_mask.sum())
                data[:, ~valid_mask] = 0
                dst.write(data, window=window)
                mask_dst.write(valid_mask.astype(np.uint8), 1, window=window)
            return valid_pixel_count


def _write_common_valid_mask(t1_mask_path: Path, t2_mask_path: Path, output_path: Path) -> int:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        output_path.unlink()
    with rasterio.open(t1_mask_path) as t1, rasterio.open(t2_mask_path) as t2:
        if t1.width != t2.width or t1.height != t2.height or t1.transform != t2.transform:
            raise ValueError(
                f"valid mask grid mismatch: {t1_mask_path} vs {t2_mask_path}"
            )
        profile = t1.profile.copy()
        profile.update(count=1, dtype="uint8", nodata=0, compress="lzw", BIGTIFF="IF_SAFER")
        common_valid_pixel_count = 0
        with rasterio.open(output_path, "w", **profile) as dst:
            for _, window in dst.block_windows(1):
                t1_mask = t1.read(1, window=window) > 0
                t2_mask = t2.read(1, window=window) > 0
                common = np.logical_and(t1_mask, t2_mask)
                common_valid_pixel_count += int(common.sum())
                dst.write(common.astype(np.uint8), 1, window=window)
        return common_valid_pixel_count


def _sample_common_valid_data(
    pair: PairPreflight,
    chip: SheetChip,
    *,
    max_sample_pixels: int,
) -> SheetValidSample:
    sample_factor = max(
        1,
        int(math.ceil(math.sqrt(chip.grid.pixel_count / max(1, max_sample_pixels)))),
    )
    sample_gsd = chip.grid.target_gsd_m * sample_factor
    left, bottom, right, top = chip.grid.bounds_5186
    width = max(1, int(math.ceil((right - left) / sample_gsd)))
    height = max(1, int(math.ceil((top - bottom) / sample_gsd)))
    transform = from_origin(left, top, sample_gsd, sample_gsd)
    core_mask = rasterize(
        [(chip.core_geometry_5186, 1)],
        out_shape=(height, width),
        transform=transform,
        fill=0,
        dtype=np.uint8,
        all_touched=True,
    ).astype(bool)
    core_count = int(core_mask.sum())
    if core_count <= 0:
        return SheetValidSample(
            sheet_code=chip.sheet_code,
            core_sample_pixel_count=0,
            common_valid_sample_pixel_count=0,
            common_valid_ratio=0.0,
            sample_width=width,
            sample_height=height,
        )
    t1_valid = _sample_source_valid_mask(
        pair.standard,
        width=width,
        height=height,
        transform=transform,
    )
    t2_valid = _sample_source_valid_mask(
        pair.compare,
        width=width,
        height=height,
        transform=transform,
    )
    common_valid_count = int(np.logical_and.reduce((core_mask, t1_valid, t2_valid)).sum())
    return SheetValidSample(
        sheet_code=chip.sheet_code,
        core_sample_pixel_count=core_count,
        common_valid_sample_pixel_count=common_valid_count,
        common_valid_ratio=float(common_valid_count / max(1, core_count)),
        sample_width=width,
        sample_height=height,
    )


def _sample_source_valid_mask(
    source: RasterPreflight,
    *,
    width: int,
    height: int,
    transform: Any,
) -> np.ndarray:
    with rasterio.open(source.path) as src:
        if src.count < 3:
            raise ValueError(f"source raster must have at least 3 bands: {source.path}")
        with WarpedVRT(
            src,
            crs=TARGET_CRS,
            transform=transform,
            width=width,
            height=height,
            src_nodata=src.nodata,
            nodata=0,
            resampling=Resampling.nearest,
        ) as vrt:
            data = vrt.read(indexes=(1, 2, 3))
            valid_mask = vrt.read_masks(1) > 0
            if source.rgb_nodata_color is not None:
                valid_mask &= _rgb_valid_mask(
                    data,
                    color=source.rgb_nodata_color,
                    tolerance=source.rgb_nodata_tolerance or 0,
                )
            alpha_index = _alpha_band_index(src)
            if alpha_index is not None:
                alpha = vrt.read(alpha_index)
                valid_mask &= alpha > 0
            return valid_mask


def _rgb_valid_mask(
    data: np.ndarray,
    *,
    color: tuple[int, int, int],
    tolerance: int,
) -> np.ndarray:
    reference = np.asarray(color, dtype=np.int32)[:, np.newaxis, np.newaxis]
    data_i = data.astype(np.int32, copy=False)
    if int(tolerance) <= 0:
        invalid = np.all(data_i == reference, axis=0)
    else:
        invalid = np.all(np.abs(data_i - reference) <= int(tolerance), axis=0)
    return np.logical_not(invalid)


def _alpha_band_index(src: rasterio.DatasetReader) -> int | None:
    if src.count < 4:
        return None
    for index, interpretation in enumerate(tuple(src.colorinterp or ()), start=1):
        if interpretation == ColorInterp.alpha:
            return index
    return None


def _resampling(name: str) -> Resampling:
    normalized = name.strip().lower()
    aliases = {
        "bicubic": "cubic",
    }
    normalized = aliases.get(normalized, normalized)
    try:
        return Resampling[normalized]
    except KeyError as exc:
        valid = ", ".join(item.name for item in Resampling)
        raise ValueError(f"unsupported resampling method: {name}; valid={valid}") from exc


def _tile_size(length: int) -> int:
    if length >= 512:
        return 512
    return max(16, int(math.ceil(length / 16) * 16))
