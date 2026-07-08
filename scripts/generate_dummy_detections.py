"""더미 변화탐지 데이터 생성 스크립트.

본 스크립트는 컨테이너 내부에서 실행한다.
    docker compose --profile tools run --rm scripts \\
        python scripts/generate_dummy_detections.py

산출물:
    frontend/public/data/regions/sheets-index.geojson  (5179 → 4326 변환)
    frontend/public/data/sheets/index.json             (선택된 도엽 메타)
    frontend/public/data/sheets/{code}/detections.json (도엽별 폴리곤 100~150개)
    frontend/public/data/datasets/index.json           (정사영상 더미 5~6개)
    frontend/public/data/tasks/index.json              (작업 1건)

기준 도엽:
    - 안양 (37708034)
    - 안양 인접 격자 1개 (스크립트가 자동으로 인접한 도엽 1개 선택)

좌표계:
    - 입력 GeoJSON: EPSG:5179 (전국_권역_5K_5179.geojson)
    - 출력 (프론트 fetch 대상): EPSG:4326
    - 백엔드 DB 표준: EPSG:5186 (이정표 4 적용 시 재변환)
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path
from typing import Any, Iterable

import geopandas as gpd
from shapely.geometry import MultiPolygon, Polygon, mapping
from shapely.geometry.base import BaseGeometry

# ============================================================
# 경로 설정
# ============================================================

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA_ROOT = REPO_ROOT / "frontend" / "public" / "data"
SHEETS_DATA_ROOT = PUBLIC_DATA_ROOT / "sheets"
REGIONS_DATA_ROOT = PUBLIC_DATA_ROOT / "regions"
DATASETS_DATA_ROOT = PUBLIC_DATA_ROOT / "datasets"
TASKS_DATA_ROOT = PUBLIC_DATA_ROOT / "tasks"

# 도엽 격자 GeoJSON 입력 경로.
# 우선순위: 환경변수 SHEET_INDEX_PATH > {repo}/.cache/sheets-index-5179.geojson.
# 컨테이너 실행: 볼륨 마운트로 /workspace/.cache 가 보임. 호스트 실행: 동일 경로.
import os as _os

_SHEET_INDEX_ENV = _os.getenv("SHEET_INDEX_PATH")
SHEET_INDEX_INPUT = Path(_SHEET_INDEX_ENV) if _SHEET_INDEX_ENV else (
    REPO_ROOT / ".cache" / "sheets-index-5179.geojson"
)

# ============================================================
# 도엽 / 변화 유형 / 행정구역 메타
# ============================================================

PRIMARY_SHEET_CODE = "37708034"

# PROMPTS §1 비율
CHANGE_TYPE_DISTRIBUTION: list[tuple[str, str, int, tuple[float, float]]] = [
    # (change_type, model, count, (area_min_m2, area_max_m2))
    ("building_new", "building", 14, (30.0, 500.0)),
    ("building_removed", "building", 6, (30.0, 500.0)),
    ("building_updated", "building", 63, (30.0, 500.0)),
    ("building_color", "building", 39, (30.0, 500.0)),
    ("road_new", "road", 15, (100.0, 3000.0)),
    ("road_removed", "road", 11, (100.0, 3000.0)),
    ("road_updated", "road", 0, (100.0, 3000.0)),  # 0 — 안양 권역에서는 미발생
]

REGION_CODES_ANYANG = [
    ("41171010", "경기도 안양시 만안구 안양동"),
    ("41171020", "경기도 안양시 만안구 석수동"),
    ("41171030", "경기도 안양시 만안구 박달동"),
    ("41173010", "경기도 안양시 동안구 비산동"),
    ("41173020", "경기도 안양시 동안구 호계동"),
    ("41173030", "경기도 안양시 동안구 평촌동"),
]

# 변화 유형별 base confidence 분포 (UI 시연용 자연스러움)
CONFIDENCE_RANGE = (45, 98)


# ============================================================
# 로딩 / 변환
# ============================================================


def load_sheet_index_4326() -> gpd.GeoDataFrame:
    """전국 도엽 격자 GeoJSON(5179) 을 4326 으로 변환해 반환."""
    if not SHEET_INDEX_INPUT.exists():
        raise FileNotFoundError(
            f"도엽 격자 입력 파일이 없습니다: {SHEET_INDEX_INPUT}\n"
            "스크립트 실행 전에 host 의 전국_권역_5K_5179.geojson 을 "
            f"{SHEET_INDEX_INPUT.relative_to(SHEET_INDEX_INPUT.parents[2])} "
            "로 복사해 두세요."
        )
    gdf = gpd.read_file(str(SHEET_INDEX_INPUT))
    if gdf.crs is None:
        gdf.set_crs(epsg=5179, inplace=True)
    gdf_4326 = gdf.to_crs(epsg=4326)
    return gdf_4326


def write_sheets_index_geojson(gdf_4326: gpd.GeoDataFrame, out_path: Path) -> None:
    """도엽 격자 전체를 4326 GeoJSON 으로 저장.

    이정표 2 지도는 권역 디졸브 버전을 우선 사용.
    본 격자 파일은 백엔드 시드(이정표 4)와 줌인 시 도엽 단위 표시(추후) 용으로 보존.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    gdf_out = gdf_4326.rename(columns={"MAPIDCD_NO": "code", "layer": "region"})
    gdf_out.to_file(str(out_path), driver="GeoJSON")
    print(f"  ✓ {out_path.relative_to(REPO_ROOT)} ({len(gdf_out):,} features)")


def write_regions_dissolved_geojson(
    gdf_4326: gpd.GeoDataFrame,
    out_path: Path,
) -> None:
    """권역 단위로 디졸브한 GeoJSON 저장 (8 features).

    이정표 2 지도의 기본 overlay. 17,034 폴리곤 → 8 폴리곤으로 렌더 비용 대폭 감소.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df = gdf_4326.rename(columns={"layer": "region_full", "MAPIDCD_NO": "code"})
    df["region"] = df["region_full"].str.replace(" 권역", "", regex=False)

    # 권역별 도엽 개수 (디졸브 전에 집계)
    counts = df.groupby("region").size().to_dict()

    dissolved = df.dissolve(by="region", as_index=False)
    dissolved["sheet_count"] = dissolved["region"].map(counts).astype(int)
    keep_cols = ["region", "region_full", "sheet_count", "geometry"]
    dissolved = dissolved[keep_cols]

    dissolved.to_file(str(out_path), driver="GeoJSON")
    print(
        f"  ✓ {out_path.relative_to(REPO_ROOT)} ({len(dissolved)} features — 권역 디졸브)"
    )


# ============================================================
# 도엽 더미 폴리곤 생성
# ============================================================


def _bounds_of(geom: BaseGeometry) -> tuple[float, float, float, float]:
    return geom.bounds  # (minx, miny, maxx, maxy)


def _random_polygon(
    bounds: tuple[float, float, float, float],
    target_area_m2: float,
    n_vertices: int,
) -> Polygon:
    """주어진 bbox(EPSG:4326) 안에 무작위 위치·5~8각형 폴리곤 생성.

    target_area_m2 를 위·경도 차이로 환산해 반경(deg) 산정. 위도 보정 적용.
    """
    minx, miny, maxx, maxy = bounds
    cx = random.uniform(minx, maxx)
    cy = random.uniform(miny, maxy)

    cos_lat = math.cos(math.radians(cy))
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * cos_lat

    # 정원 면적 = pi * r^2 → r(m) = sqrt(A/pi)
    r_m = math.sqrt(max(target_area_m2, 1.0) / math.pi)
    r_lat = r_m / m_per_deg_lat
    r_lon = r_m / m_per_deg_lon

    coords: list[tuple[float, float]] = []
    base_angle = random.random() * 2.0 * math.pi
    for i in range(n_vertices):
        ang = base_angle + (2.0 * math.pi * i / n_vertices)
        # 0.7~1.3 배 무작위 변형
        scale = random.uniform(0.7, 1.3)
        x = cx + r_lon * scale * math.cos(ang)
        y = cy + r_lat * scale * math.sin(ang)
        coords.append((x, y))
    coords.append(coords[0])
    return Polygon(coords)


def _polygon_area_m2(poly: Polygon) -> float:
    """평면 근사 (한국 위도에서 충분한 정확도)."""
    cy = (poly.bounds[1] + poly.bounds[3]) / 2.0
    cos_lat = math.cos(math.radians(cy))
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * cos_lat
    return abs(poly.area) * m_per_deg_lat * m_per_deg_lon


def generate_detections_for_sheet(
    sheet_code: str,
    sheet_geom_4326: BaseGeometry,
    seed: int,
) -> list[dict[str, Any]]:
    """단일 도엽분의 detection 객체 리스트 생성."""
    random.seed(seed)
    bounds = _bounds_of(sheet_geom_4326)
    detections: list[dict[str, Any]] = []
    counter = 0
    for change_type, model, count, area_range in CHANGE_TYPE_DISTRIBUTION:
        for _ in range(count):
            target_area = random.uniform(*area_range)
            n_vertices = random.randint(5, 8)
            poly = _random_polygon(bounds, target_area, n_vertices)
            counter += 1
            region_code, address = random.choice(REGION_CODES_ANYANG)
            obj_id = f"obj_{sheet_code}_{model[0]}{counter:04d}"
            detections.append(
                {
                    "id": obj_id,
                    "sheet_code": sheet_code,
                    "model": model,
                    "change_type": change_type,
                    "confidence": random.randint(*CONFIDENCE_RANGE),
                    "area_m2": round(_polygon_area_m2(poly), 2),
                    "geometry": mapping(poly),
                    "region_code": region_code,
                    "address": address,
                    "error_class": None,
                    "reviewer_memo": "",
                    "reviewed_by": None,
                    "reviewed_at": None,
                    "is_user_added": False,
                    "is_deleted": False,
                }
            )
    random.shuffle(detections)
    return detections


# ============================================================
# 도엽 메타·데이터셋·작업 생성
# ============================================================


def pick_target_sheets(
    gdf_4326: gpd.GeoDataFrame,
    primary_code: str,
) -> gpd.GeoDataFrame:
    """기준 도엽(primary) + 인접 도엽 1개 선택."""
    df = gdf_4326.rename(columns={"MAPIDCD_NO": "code", "layer": "region"})
    primary = df[df["code"] == primary_code]
    if primary.empty:
        raise ValueError(f"기준 도엽 {primary_code} 가 인덱스에 없습니다")
    primary_geom = primary.iloc[0].geometry
    primary_centroid = primary_geom.centroid

    # 인접 도엽: 같은 권역에서 거리가 가까운 다음 도엽
    same_region = df[
        (df["region"] == primary.iloc[0]["region"])
        & (df["code"] != primary_code)
    ].copy()
    if same_region.empty:
        return primary
    same_region["_d"] = same_region.geometry.centroid.distance(primary_centroid)
    same_region.sort_values("_d", inplace=True)
    secondary = same_region.head(1).drop(columns=["_d"])
    return gpd.GeoDataFrame(
        list(primary.to_dict("records")) + list(secondary.to_dict("records")),
        crs=df.crs,
    )


def make_sheet_meta(row: dict[str, Any], task_id: str) -> dict[str, Any]:
    """프론트엔드 MapSheet 형태로 메타 변환."""
    geom: BaseGeometry = row["geometry"]
    if isinstance(geom, MultiPolygon):
        # 단일 polygon 으로 단순화 (UI 표시용)
        polys = list(geom.geoms)
        polys.sort(key=lambda g: g.area, reverse=True)
        geom = polys[0]
    minx, miny, maxx, maxy = geom.bounds
    code = str(row["code"])
    region_full: str = str(row["region"])
    region_short = region_full.replace(" 권역", "")

    # 면적 (km²) 근사
    cy = (miny + maxy) / 2.0
    cos_lat = math.cos(math.radians(cy))
    area_km2 = abs(geom.area) * 111.32 * 111.32 * cos_lat

    return {
        "code": code,
        "name": _sheet_name_for(code),
        "region": region_short,
        "bbox": [minx, miny, maxx, maxy],
        "geometry": mapping(geom),
        "area_km2": round(area_km2, 3),
        "review_status": "pending",
        "reviewer": None,
        "reviewed_at": None,
        "task_id": task_id,
        "models": ["building", "road"],
        "compare_type": "image-image",
        "standard_resource_id": 1001,
        "compare_resource_id": 1002,
        "f1_score": None,
        "precision": None,
        "recall": None,
        "total_detections": 0,
        "reviewed_detections": 0,
        "tp_count": 0,
        "fp_count": 0,
        "fn_count": 0,
    }


def _sheet_name_for(code: str) -> str:
    # 안양 외 도엽명은 코드 prefix 로 대체.
    if code == PRIMARY_SHEET_CODE:
        return "안양"
    return f"도엽-{code}"


def make_dummy_datasets(sheet_codes: list[str], bbox: list[float]) -> list[dict[str, Any]]:
    """정사영상 더미 5~6건. 이정표 2·4 화면 시연용."""
    polygon_bbox = {
        "type": "Polygon",
        "coordinates": [
            [
                [bbox[0], bbox[1]],
                [bbox[2], bbox[1]],
                [bbox[2], bbox[3]],
                [bbox[0], bbox[3]],
                [bbox[0], bbox[1]],
            ]
        ],
    }
    datasets = [
        {
            "id": 1001,
            "source": "aerial",
            "display_name": "Anyang_2022_aerial.tif",
            "platform": "항공",
            "taken_start_at": "2022-04-01T00:00:00Z",
            "taken_end_at": "2022-04-30T00:00:00Z",
            "bbox": polygon_bbox,
            "tile_path": None,
            "sheet_codes": sheet_codes,
            "status": "ready",
            "thumbnail_url": None,
            "size_bytes": 524_288_000,
        },
        {
            "id": 1002,
            "source": "aerial",
            "display_name": "Anyang_2024_aerial.tif",
            "platform": "항공",
            "taken_start_at": "2024-05-01T00:00:00Z",
            "taken_end_at": "2024-05-31T00:00:00Z",
            "bbox": polygon_bbox,
            "tile_path": None,
            "sheet_codes": sheet_codes,
            "status": "ready",
            "thumbnail_url": None,
            "size_bytes": 587_202_560,
        },
        {
            "id": 1003,
            "source": "external",
            "display_name": "Suwon_2023_satellite.tif",
            "platform": "위성",
            "taken_start_at": "2023-07-15T00:00:00Z",
            "taken_end_at": "2023-07-15T00:00:00Z",
            "bbox": polygon_bbox,
            "tile_path": None,
            "sheet_codes": [],
            "status": "ready",
            "thumbnail_url": None,
            "size_bytes": 314_572_800,
        },
        {
            "id": 1004,
            "source": "upload",
            "display_name": "Pyeongchon_drone_2024.tif",
            "platform": "드론",
            "taken_start_at": "2024-09-10T00:00:00Z",
            "taken_end_at": "2024-09-10T00:00:00Z",
            "bbox": polygon_bbox,
            "tile_path": None,
            "sheet_codes": sheet_codes[:1],
            "status": "ready",
            "thumbnail_url": None,
            "size_bytes": 209_715_200,
        },
        {
            "id": 1005,
            "source": "upload",
            "display_name": "Bucheon_2024_aerial.tif",
            "platform": "항공",
            "taken_start_at": "2024-08-05T00:00:00Z",
            "taken_end_at": "2024-08-20T00:00:00Z",
            "bbox": polygon_bbox,
            "tile_path": None,
            "sheet_codes": [],
            "status": "processing",
            "thumbnail_url": None,
            "size_bytes": 419_430_400,
        },
        {
            "id": 1006,
            "source": "external",
            "display_name": "Anyang_2024_drone_supplement.tif",
            "platform": "드론",
            "taken_start_at": "2024-06-01T00:00:00Z",
            "taken_end_at": "2024-06-15T00:00:00Z",
            "bbox": polygon_bbox,
            "tile_path": None,
            "sheet_codes": sheet_codes[:1],
            "status": "ready",
            "thumbnail_url": None,
            "size_bytes": 167_772_160,
        },
    ]
    return datasets


def make_dummy_task(sheet_codes: list[str]) -> dict[str, Any]:
    return {
        "id": "task-anyang-2024-001",
        "name": "안양 권역 2022→2024 변화탐지",
        "description": "기준 정사영상(2022) ↔ 비교 정사영상(2024) 건물·도로 변화탐지",
        "models": ["building", "road"],
        "compare_type": "image-image",
        "standard_resource_id": 1001,
        "compare_resource_id": 1002,
        "sheet_codes": sheet_codes,
        "status": "succeeded",
        "progress": 100,
        "created_at": "2024-09-01T00:00:00Z",
        "finished_at": "2024-09-01T01:30:00Z",
        "celery_task_id": None,
    }


# ============================================================
# 메인
# ============================================================


def _ensure_dirs(paths: Iterable[Path]) -> None:
    for p in paths:
        p.mkdir(parents=True, exist_ok=True)


def main() -> None:
    print("[1/4] 도엽 격자 GeoJSON 5179 → 4326 변환 + 권역 디졸브")
    gdf_4326 = load_sheet_index_4326()
    write_sheets_index_geojson(
        gdf_4326,
        REGIONS_DATA_ROOT / "sheets-index.geojson",
    )
    write_regions_dissolved_geojson(
        gdf_4326,
        REGIONS_DATA_ROOT / "regions.geojson",
    )

    print("[2/4] 기준 도엽 + 인접 도엽 선정")
    target_gdf = pick_target_sheets(gdf_4326, PRIMARY_SHEET_CODE)
    target_codes: list[str] = [str(r["code"]) for _, r in target_gdf.iterrows()]
    for code, _ in zip(target_codes, target_gdf.iterrows()):
        print(f"  ✓ 선정 도엽: {code}")

    task = make_dummy_task(target_codes)
    sheet_metas: list[dict[str, Any]] = []
    for _, row in target_gdf.iterrows():
        meta = make_sheet_meta(row.to_dict(), task["id"])
        sheet_metas.append(meta)

    print("[3/4] 도엽별 더미 변화탐지 폴리곤 생성")
    _ensure_dirs([SHEETS_DATA_ROOT, DATASETS_DATA_ROOT, TASKS_DATA_ROOT])
    for idx, meta in enumerate(sheet_metas):
        sheet_code = meta["code"]
        seed = int(sheet_code) + 7
        sheet_dir = SHEETS_DATA_ROOT / sheet_code
        sheet_dir.mkdir(parents=True, exist_ok=True)
        from shapely.geometry import shape

        sheet_geom = shape(meta["geometry"])
        detections = generate_detections_for_sheet(sheet_code, sheet_geom, seed)
        # 두 번째 도엽은 폴리곤 수를 약간 줄이기 (UX 다양성)
        if idx > 0:
            detections = detections[: int(len(detections) * 0.7)]
        with (sheet_dir / "detections.json").open("w", encoding="utf-8") as f:
            json.dump(detections, f, ensure_ascii=False, indent=2)
        meta["total_detections"] = len(detections)
        print(
            f"  ✓ frontend/public/data/sheets/{sheet_code}/detections.json "
            f"({len(detections)} polygons)"
        )

    # sheets/index.json
    sheets_index = {"sheets": sheet_metas}
    with (SHEETS_DATA_ROOT / "index.json").open("w", encoding="utf-8") as f:
        json.dump(sheets_index, f, ensure_ascii=False, indent=2)
    print(f"  ✓ frontend/public/data/sheets/index.json ({len(sheet_metas)} sheets)")

    print("[4/4] 데이터셋·작업 더미")
    primary = sheet_metas[0]
    datasets = make_dummy_datasets(target_codes, primary["bbox"])
    with (DATASETS_DATA_ROOT / "index.json").open("w", encoding="utf-8") as f:
        json.dump({"datasets": datasets}, f, ensure_ascii=False, indent=2)
    print(f"  ✓ frontend/public/data/datasets/index.json ({len(datasets)} datasets)")

    with (TASKS_DATA_ROOT / "index.json").open("w", encoding="utf-8") as f:
        json.dump({"tasks": [task]}, f, ensure_ascii=False, indent=2)
    print(f"  ✓ frontend/public/data/tasks/index.json (1 task)")

    print("\n완료. 프론트엔드는 /data/* 정적 JSON 으로 부터 데이터를 가져옵니다.")


if __name__ == "__main__":
    main()
