"""3D DXF Export 통합 테스트 공통 fixture.

작은 합성 sheet index (2개 도엽) + 2개의 모킹된 DEM .tif + 합성 폴리곤 GPKG 를
임시 디렉토리에 만들어 service-level / endpoint-level 양쪽에서 재사용.

테스트는 도엽 파일명 패턴을 `{sheet_code}.tif` 로 두는데, 운영 환경의 `.img`
설정과 알고리즘은 무관 — rasterio/GDAL 이 두 포맷을 동일하게 다룬다.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import geopandas as gpd
import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import Polygon


# ============================================================
# 좌표 상수 — EPSG:5186 가상의 두 도엽
# ============================================================
# 도엽 A: (1000, 1000) ~ (2000, 2000) — 1km × 1km
# 도엽 B: (2000, 1000) ~ (3000, 2000) — 도엽 A 동쪽 인접
#
# 폴리곤 P1: 도엽 A 내부 (단일 도엽)
# 폴리곤 P2: 도엽 A·B 경계 걸침 (다중 도엽 — VRT 효과 검증)

SHEET_A_BOUNDS = (1000, 1000, 2000, 2000)
SHEET_B_BOUNDS = (2000, 1000, 3000, 2000)
SHEET_A_CODE = "TESTA001"
SHEET_B_CODE = "TESTB001"


def _build_dem_tif(
    out_path: Path,
    bounds: tuple[float, float, float, float],
    pixel_size: float,
    constant_z: float,
) -> None:
    """주어진 bbox 를 채우는 단일 band float32 .tif. 모든 픽셀 = constant_z."""
    minx, miny, maxx, maxy = bounds
    width = int((maxx - minx) / pixel_size)
    height = int((maxy - miny) / pixel_size)
    data = np.full((height, width), constant_z, dtype=np.float32)
    transform = from_origin(minx, maxy, pixel_size, pixel_size)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        out_path, "w",
        driver="GTiff",
        height=height,
        width=width,
        count=1,
        dtype="float32",
        crs="EPSG:5186",
        transform=transform,
        nodata=-9999.0,
    ) as ds:
        ds.write(data, 1)


def _coerce_string_to_object(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """pandas 2.2+ 의 StringDtype(na_value=nan) 을 fiona schema infer 가 처리 못하는
    회귀를 우회. .to_file(engine="fiona") 직전에 object dtype 으로 강제.

    str(dtype) 비교는 못 쓴다 — 본 StringDtype 변종은 str() 가 'str' 을 돌려준다.
    isinstance(dtype, pd.StringDtype) 만 신뢰 가능.
    """
    import pandas as pd
    for col in gdf.columns:
        if col == "geometry":
            continue
        if isinstance(gdf[col].dtype, pd.StringDtype):
            gdf[col] = gdf[col].astype(object)
    return gdf


def _build_sheet_index(out_path: Path) -> None:
    """두 도엽의 bbox 폴리곤 + MAPIDCD_NO 컬럼."""
    rows = [
        {"MAPIDCD_NO": SHEET_A_CODE, "geometry": Polygon.from_bounds(*SHEET_A_BOUNDS)},
        {"MAPIDCD_NO": SHEET_B_CODE, "geometry": Polygon.from_bounds(*SHEET_B_BOUNDS)},
    ]
    geoms = [r.pop("geometry") for r in rows]
    gdf = gpd.GeoDataFrame(rows, geometry=geoms, crs="EPSG:5186")
    gdf = _coerce_string_to_object(gdf)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(out_path, driver="GeoJSON")


def _build_polygons_gpkg(out_path: Path) -> None:
    """변화탐지 폴리곤 — P1 (도엽 A 내부), P2 (A·B 경계)."""
    p1 = Polygon([
        (1200, 1200), (1400, 1200), (1400, 1400), (1200, 1400),
    ])  # 4 vertex (closed = 5 with repeated first)
    p2 = Polygon([
        (1800, 1300), (2200, 1300), (2200, 1500), (1800, 1500),
    ])  # 도엽 경계 가로지름
    rows = [
        {"id": "obj_001", "change_type": "building_new", "geometry": p1},
        {"id": "obj_002", "change_type": "road_updated", "geometry": p2},
    ]
    geoms = [r.pop("geometry") for r in rows]
    gdf = gpd.GeoDataFrame(rows, geometry=geoms, crs="EPSG:5186")
    gdf = _coerce_string_to_object(gdf)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(out_path, driver="GPKG")


@pytest.fixture
def export_env(tmp_path: Path):
    """전체 export 환경 — sheet_index + dem_dir + polygons GPKG.

    Returns
    -------
    dict with keys: tmp_root, sheet_index_path, dem_dir, polygons_path,
                    sheet_a_z, sheet_b_z
    """
    root = tmp_path
    sheet_index_path = root / "sheet_index" / "grid.geojson"
    dem_dir = root / "dem"
    polygons_path = root / "polygons.gpkg"

    # 두 도엽에 서로 다른 z 값 — VRT 동작 검증용
    sheet_a_z = 50.0
    sheet_b_z = 80.0

    _build_sheet_index(sheet_index_path)
    _build_dem_tif(
        dem_dir / f"{SHEET_A_CODE}.tif",
        SHEET_A_BOUNDS, pixel_size=5.0, constant_z=sheet_a_z,
    )
    _build_dem_tif(
        dem_dir / f"{SHEET_B_CODE}.tif",
        SHEET_B_BOUNDS, pixel_size=5.0, constant_z=sheet_b_z,
    )
    _build_polygons_gpkg(polygons_path)

    yield {
        "tmp_root": root,
        "sheet_index_path": sheet_index_path,
        "dem_dir": dem_dir,
        "polygons_path": polygons_path,
        "sheet_a_z": sheet_a_z,
        "sheet_b_z": sheet_b_z,
        "sheet_a_code": SHEET_A_CODE,
        "sheet_b_code": SHEET_B_CODE,
    }

    # tmp_path 는 pytest 가 자동 정리 — 수동 정리는 cleanup 의 의미상만 둠.
    shutil.rmtree(root, ignore_errors=True)
