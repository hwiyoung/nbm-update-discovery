"""
dem_z_export.py

3D DXF Export Service for Change Detection Objects.

Takes 2D change detection polygons (변화탐지 객체) and injects Z values
sampled from per-sheet DEM tiles (도엽단위 DEM), producing a 3D DXF output.

Design overview
---------------
- Inputs are file-based (vector + raster), no database dependency
- Project-scoped: builds a Virtual Raster (VRT) per export request
- Object-level processing: samples all vertices of a polygon at once
- Stateful service: instantiate once at app startup, reuse across exports

Architecture
------------
    [polygons file] + [sheet index SHP] + [DEM .tif files]
                            ↓
                   DEMZExportService.export()
                            ↓
              ① Load polygons → ② Validate CRS
                            ↓
              ③ Identify intersecting sheets (sindex)
                            ↓
              ④ Build per-project VRT
                            ↓
              ⑤ Iterate objects → sample → assemble 3D
                            ↓
              ⑥ Write DXF → return ExportResult

Usage
-----
    from dem_z_export import DEMZExportService

    # At app startup (sheet index loaded once)
    service = DEMZExportService(
        sheet_index_path="data/TN_MAPINDX_5K_5179.shp",
        dem_dir="data/dem",
        sheet_code_field="도엽코드",
        target_crs="EPSG:5186",
    )

    # Per export call
    result = service.export(
        polygons_path="projects/proj_123/change_detection.gpkg",
        output_dxf_path="projects/proj_123/exports/3d_changes.dxf",
        layer_name="VARIATION",
    )
    print(result.summary())

Author: innoPAM
"""

from __future__ import annotations

import logging
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

import ezdxf
import geopandas as gpd
import numpy as np
import rasterio
import rasterio.windows
from osgeo import gdal
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry

logger = logging.getLogger(__name__)


# ============================================================================
# Exceptions
# ============================================================================

class DEMZExportError(Exception):
    """Base exception for DEM Z export errors."""


class CRSMismatchError(DEMZExportError):
    """Raised when polygon and DEM CRS cannot be reconciled."""


class MissingDEMError(DEMZExportError):
    """Raised when expected DEM tiles for project area are missing."""


# ============================================================================
# Result dataclass
# ============================================================================

@dataclass
class ExportResult:
    """Result and statistics from a single DXF export run."""

    output_path: Path
    total_objects: int = 0
    total_vertices: int = 0
    sheets_used: list[str] = field(default_factory=list)
    missing_sheets: list[str] = field(default_factory=list)
    nodata_vertex_count: int = 0
    objects_with_nodata: list[str] = field(default_factory=list)
    elapsed_seconds: float = 0.0

    def summary(self) -> str:
        return "\n".join([
            "DXF Export Summary",
            f"  Output:           {self.output_path}",
            f"  Objects:          {self.total_objects:,}",
            f"  Vertices:         {self.total_vertices:,}",
            f"  Sheets used:      {len(self.sheets_used)}",
            f"  Missing sheets:   {len(self.missing_sheets)}",
            f"  NoData vertices:  {self.nodata_vertex_count}",
            f"  Affected objects: {len(self.objects_with_nodata)}",
            f"  Elapsed:          {self.elapsed_seconds:.2f}s",
        ])

    def to_dict(self) -> dict:
        return {
            "output_path": str(self.output_path),
            "total_objects": self.total_objects,
            "total_vertices": self.total_vertices,
            "sheets_used": self.sheets_used,
            "missing_sheets": self.missing_sheets,
            "nodata_vertex_count": self.nodata_vertex_count,
            "objects_with_nodata": self.objects_with_nodata,
            "elapsed_seconds": self.elapsed_seconds,
        }


# ============================================================================
# Main Service
# ============================================================================

class DEMZExportService:
    """
    Service for injecting DEM Z values into change detection polygons
    and exporting as 3D DXF.

    The sheet index SHP is loaded once at construction and held in memory
    with a spatial index (R-tree). Multiple export() calls share that index,
    so instantiate this service once per process and reuse it.

    Parameters
    ----------
    sheet_index_path : str | Path
        Path to the 1:5,000 sheet index SHP (e.g., TN_MAPINDX_5K_5179.shp).
    dem_dir : str | Path
        Directory containing DEM tiles, one per sheet code.
    sheet_code_field : str
        Field name in the sheet index identifying sheet codes (default "도엽코드").
    target_crs : str
        CRS used for all internal processing (default "EPSG:5186").
        Polygons and sheet index will be reprojected to this CRS if needed.
    dem_filename_pattern : str
        Format template for DEM filenames, with `{sheet_code}` placeholder.
    sample_method : str
        Either "bilinear" (default, recommended) or "nearest".
    """

    def __init__(
        self,
        sheet_index_path: str | Path,
        dem_dir: str | Path,
        sheet_code_field: str = "도엽코드",
        target_crs: str = "EPSG:5186",
        dem_filename_pattern: str = "{sheet_code}.tif",
        sample_method: str = "bilinear",
    ):
        if sample_method not in ("bilinear", "nearest"):
            raise ValueError(f"sample_method must be 'bilinear' or 'nearest', got {sample_method}")

        self.dem_dir = Path(dem_dir)
        self.sheet_code_field = sheet_code_field
        self.target_crs = target_crs
        self.dem_filename_pattern = dem_filename_pattern
        self.sample_method = sample_method

        self._sheets = self._load_sheet_index(sheet_index_path)
        logger.info(
            "DEMZExportService initialized: %d sheets indexed (CRS=%s)",
            len(self._sheets), self.target_crs,
        )

    # ------------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------------

    def export(
        self,
        polygons_path: str | Path,
        output_dxf_path: str | Path,
        layer_name: str = "CHANGE_DETECTION",
    ) -> ExportResult:
        """
        Run a full export.

        Parameters
        ----------
        polygons_path : str | Path
            Path to change detection polygons (GPKG, SHP, or GeoJSON).
        output_dxf_path : str | Path
            Where the 3D DXF file should be written.
        layer_name : str
            DXF layer name for the polygons.

        Returns
        -------
        ExportResult
            Statistics and quality metrics from the run.
        """
        t_start = time.time()
        result = ExportResult(output_path=Path(output_dxf_path))

        # 1. Load + validate polygons
        polygons = gpd.read_file(polygons_path)
        polygons = self._validate_and_align_crs(polygons)
        result.total_objects = len(polygons)

        if len(polygons) == 0:
            logger.warning("No polygons in input. Writing empty DXF.")
            self._write_dxf([], Path(output_dxf_path), layer_name)
            result.elapsed_seconds = time.time() - t_start
            return result

        # 2. Identify intersecting sheets via sindex
        sheet_codes = self._identify_intersecting_sheets(polygons)
        result.sheets_used = sheet_codes

        # 3. Resolve DEM file paths, check existence
        dem_files, missing = self._resolve_dem_files(sheet_codes)
        result.missing_sheets = missing
        if not dem_files:
            raise MissingDEMError(
                f"No DEM files found for project area "
                f"(expected {len(sheet_codes)} sheets, all missing)."
            )
        if missing:
            logger.warning(
                "%d sheet DEMs missing; vertices in those areas will be NoData. "
                "First few: %s", len(missing), missing[:5]
            )

        # 4. Build per-export VRT (cleaned up in finally)
        vrt_path = Path(tempfile.mkstemp(suffix=".vrt")[1])
        try:
            self._build_vrt(dem_files, vrt_path)

            # 5. Per-object: sample Z, assemble 3D rings
            objects_with_z = self._process_objects(polygons, vrt_path, result)

            # 6. Write DXF
            self._write_dxf(objects_with_z, Path(output_dxf_path), layer_name)
        finally:
            vrt_path.unlink(missing_ok=True)

        result.elapsed_seconds = time.time() - t_start
        logger.info(
            "Export complete: %d objects, %d vertices, %d sheets, %.2fs",
            result.total_objects, result.total_vertices,
            len(result.sheets_used), result.elapsed_seconds,
        )
        return result

    # ------------------------------------------------------------------------
    # Step helpers
    # ------------------------------------------------------------------------

    def _load_sheet_index(self, path: str | Path) -> gpd.GeoDataFrame:
        gdf = gpd.read_file(path)
        if gdf.crs is None:
            raise DEMZExportError(f"Sheet index has no CRS: {path}")
        if str(gdf.crs) != self.target_crs:
            gdf = gdf.to_crs(self.target_crs)
        if self.sheet_code_field not in gdf.columns:
            raise DEMZExportError(
                f"Sheet code field '{self.sheet_code_field}' not found. "
                f"Available: {list(gdf.columns)}"
            )
        _ = gdf.sindex  # force R-tree build
        return gdf

    def _validate_and_align_crs(self, polygons: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
        if polygons.crs is None:
            raise CRSMismatchError("Input polygons have no CRS defined.")
        if str(polygons.crs) != self.target_crs:
            logger.info("Reprojecting polygons %s → %s", polygons.crs, self.target_crs)
            polygons = polygons.to_crs(self.target_crs)
        return polygons

    def _identify_intersecting_sheets(self, polygons: gpd.GeoDataFrame) -> list[str]:
        """Return sorted list of sheet codes whose bbox intersects any polygon."""
        bounds = polygons.total_bounds  # (minx, miny, maxx, maxy)
        candidate_idx = list(self._sheets.sindex.intersection(bounds))
        if not candidate_idx:
            return []

        candidates = self._sheets.iloc[candidate_idx]
        union = polygons.unary_union
        intersecting = candidates[candidates.intersects(union)]
        return sorted(intersecting[self.sheet_code_field].astype(str).tolist())

    def _resolve_dem_files(
        self, sheet_codes: Sequence[str]
    ) -> tuple[list[Path], list[str]]:
        existing, missing = [], []
        for code in sheet_codes:
            path = self.dem_dir / self.dem_filename_pattern.format(sheet_code=code)
            if path.exists():
                existing.append(path)
            else:
                missing.append(code)
        return existing, missing

    def _build_vrt(self, dem_files: Sequence[Path], vrt_path: Path) -> None:
        """Build a GDAL VRT referencing the given DEM tiles."""
        opts = gdal.BuildVRTOptions(resolution="highest", separate=False)
        ds = gdal.BuildVRT(str(vrt_path), [str(p) for p in dem_files], options=opts)
        if ds is None:
            raise DEMZExportError(f"gdal.BuildVRT failed for {len(dem_files)} tiles")
        ds.FlushCache()
        del ds
        logger.debug("Built VRT with %d tiles → %s", len(dem_files), vrt_path)

    def _process_objects(
        self,
        polygons: gpd.GeoDataFrame,
        vrt_path: Path,
        result: ExportResult,
    ) -> list[dict]:
        """Per-object: extract rings, sample Z, build (x, y, z) sequences."""
        objects_with_z: list[dict] = []

        with rasterio.open(vrt_path) as src:
            for idx, row in polygons.iterrows():
                geom = row.geometry
                if geom is None or geom.is_empty:
                    continue

                obj_id = self._get_object_id(row, idx)
                rings = self._extract_rings(geom)

                rings_3d: list[list[tuple[float, float, float]]] = []
                obj_has_nodata = False

                for ring in rings:
                    xs = np.array([p[0] for p in ring], dtype=float)
                    ys = np.array([p[1] for p in ring], dtype=float)
                    zs = self._sample_z(src, xs, ys)

                    n_nodata = int(np.isnan(zs).sum())
                    if n_nodata:
                        result.nodata_vertex_count += n_nodata
                        obj_has_nodata = True

                    ring_3d = list(zip(xs.tolist(), ys.tolist(), zs.tolist()))
                    rings_3d.append(ring_3d)
                    result.total_vertices += len(ring)

                if obj_has_nodata:
                    result.objects_with_nodata.append(str(obj_id))

                objects_with_z.append({
                    "id": obj_id,
                    "rings": rings_3d,
                    "attributes": self._extract_attributes(row),
                })

        return objects_with_z

    def _get_object_id(self, row, fallback_idx) -> str:
        for fld in ("id", "fid", "OBJECTID", "객체ID"):
            if fld in row.index:
                return str(row[fld])
        return str(fallback_idx)

    @staticmethod
    def _extract_rings(geom: BaseGeometry) -> list[list[tuple[float, float]]]:
        rings: list[list[tuple[float, float]]] = []
        if isinstance(geom, Polygon):
            rings.append(list(geom.exterior.coords))
            for interior in geom.interiors:
                rings.append(list(interior.coords))
        elif isinstance(geom, MultiPolygon):
            for part in geom.geoms:
                rings.append(list(part.exterior.coords))
                for interior in part.interiors:
                    rings.append(list(interior.coords))
        else:
            raise DEMZExportError(f"Unsupported geometry type: {type(geom).__name__}")
        return rings

    def _sample_z(
        self, src: rasterio.DatasetReader, xs: np.ndarray, ys: np.ndarray
    ) -> np.ndarray:
        if self.sample_method == "nearest":
            zs = np.array([v[0] for v in src.sample(zip(xs, ys))], dtype=float)
        else:  # bilinear
            zs = _bilinear_sample(src, xs, ys)

        nodata = src.nodata
        if nodata is not None:
            zs = np.where(np.isclose(zs, nodata), np.nan, zs)
        return zs

    @staticmethod
    def _extract_attributes(row) -> dict:
        return {k: v for k, v in row.items() if k != "geometry"}

    def _write_dxf(
        self,
        objects: Sequence[dict],
        output_path: Path,
        layer_name: str,
    ) -> None:
        """Write 3D POLYLINE entities; one per ring."""
        doc = ezdxf.new(dxfversion="R2010", setup=True)
        msp = doc.modelspace()

        if layer_name not in doc.layers:
            doc.layers.add(layer_name, color=3)  # green

        for obj in objects:
            for ring in obj["rings"]:
                # NaN (NoData) → 0.0 with the object marked in ExportResult
                pts = [(x, y, 0.0 if np.isnan(z) else z) for x, y, z in ring]
                msp.add_polyline3d(
                    pts,
                    dxfattribs={"layer": layer_name, "flags": 1},  # 1 = closed
                )

        output_path.parent.mkdir(parents=True, exist_ok=True)
        doc.saveas(str(output_path))
        logger.info("DXF saved: %s", output_path)


# ============================================================================
# Bilinear sampling helper (module-private)
# ============================================================================

def _bilinear_sample(
    src: rasterio.DatasetReader, xs: np.ndarray, ys: np.ndarray
) -> np.ndarray:
    """
    Bilinear interpolation at given world coordinates.

    Reads a single window covering all requested points to minimize I/O.
    For requests scattered across a wide area, callers should batch by object
    to keep windows compact (this module does so via object-level processing).
    """
    transform = src.transform
    a, _b, c, _d, e, f = (
        transform.a, transform.b, transform.c,
        transform.d, transform.e, transform.f,
    )

    # World → fractional pixel (assumes north-up, no rotation)
    col_f = (xs - c) / a
    row_f = (ys - f) / e

    col0 = np.floor(col_f).astype(int)
    row0 = np.floor(row_f).astype(int)
    dcol = col_f - col0
    drow = row_f - row0

    # Compact window covering all points (+1 for the 2x2 neighborhood)
    col_min = int(col0.min())
    col_max = int(col0.max()) + 2
    row_min = int(row0.min())
    row_max = int(row0.max()) + 2

    window = rasterio.windows.Window(
        col_off=col_min, row_off=row_min,
        width=col_max - col_min, height=row_max - row_min,
    )
    arr = src.read(
        1, window=window,
        boundless=True,
        fill_value=src.nodata if src.nodata is not None else np.nan,
    ).astype(float)

    # Localize indices to the window
    c0 = col0 - col_min
    r0 = row0 - row_min

    v00 = arr[r0, c0]
    v10 = arr[r0, c0 + 1]
    v01 = arr[r0 + 1, c0]
    v11 = arr[r0 + 1, c0 + 1]

    zs = (
        v00 * (1 - dcol) * (1 - drow)
        + v10 * dcol * (1 - drow)
        + v01 * (1 - dcol) * drow
        + v11 * dcol * drow
    )
    return zs


# ============================================================================
# One-shot convenience function
# ============================================================================

_SERVICE_KWARGS = {
    "sheet_code_field", "target_crs",
    "dem_filename_pattern", "sample_method",
}
_EXPORT_KWARGS = {"layer_name"}


def export_3d_dxf(
    polygons_path: str | Path,
    sheet_index_path: str | Path,
    dem_dir: str | Path,
    output_dxf_path: str | Path,
    **kwargs,
) -> ExportResult:
    """
    One-shot wrapper. For repeated calls, instantiate DEMZExportService directly
    and reuse the instance to avoid re-reading the sheet index every time.
    """
    service = DEMZExportService(
        sheet_index_path=sheet_index_path,
        dem_dir=dem_dir,
        **{k: v for k, v in kwargs.items() if k in _SERVICE_KWARGS},
    )
    return service.export(
        polygons_path=polygons_path,
        output_dxf_path=output_dxf_path,
        **{k: v for k, v in kwargs.items() if k in _EXPORT_KWARGS},
    )


__all__ = [
    "DEMZExportService",
    "ExportResult",
    "DEMZExportError",
    "CRSMismatchError",
    "MissingDEMError",
    "export_3d_dxf",
]


# ============================================================================
# Demo (manual smoke test)
# ============================================================================

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    )

    # Example — adjust paths to your environment
    service = DEMZExportService(
        sheet_index_path="data/TN_MAPINDX_5K_5179.shp",
        dem_dir="data/dem",
        sheet_code_field="도엽코드",
        target_crs="EPSG:5186",
        sample_method="bilinear",
    )

    result = service.export(
        polygons_path="data/sample/change_detection.gpkg",
        output_dxf_path="output/sample_3d.dxf",
        layer_name="VARIATION",
    )
    print(result.summary())
