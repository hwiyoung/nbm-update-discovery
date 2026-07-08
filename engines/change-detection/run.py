"""변화탐지 모델 호출 wrapper — mock 구현.

실 모델 통합 시 본 모듈의 run() 인터페이스만 유지. 외부 호출자(worker) 변경 불필요.

호출:
    from run import run
    polygons = run(bbox=[minLon, minLat, maxLon, maxLat], category="building")

반환:
    [
      {
        "change_type": "building_new",
        "confidence": 87,
        "area_m2": 245.32,
        "geometry": GeoJSON Polygon (EPSG:4326),
        "region_code": "",
        "address": "",
      },
      ...
    ]
"""

from __future__ import annotations

import math
import random
from typing import Any

# 변화 유형 분포 (PROMPTS §1 기준 + 사용자 검수 화면 시연 다양성)
_DIST_BUILDING: list[tuple[str, int, tuple[float, float]]] = [
    ("building_new", 14, (30.0, 500.0)),
    ("building_removed", 6, (30.0, 500.0)),
    ("building_updated", 63, (30.0, 500.0)),
    ("building_color", 39, (30.0, 500.0)),
]

_DIST_ROAD: list[tuple[str, int, tuple[float, float]]] = [
    ("road_new", 15, (100.0, 3000.0)),
    ("road_removed", 11, (100.0, 3000.0)),
    ("road_updated", 5, (100.0, 3000.0)),
]


def _random_polygon(
    bounds: tuple[float, float, float, float],
    target_area_m2: float,
    n_vertices: int,
) -> dict[str, Any]:
    minx, miny, maxx, maxy = bounds
    cx = random.uniform(minx, maxx)
    cy = random.uniform(miny, maxy)

    cos_lat = math.cos(math.radians(cy))
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * cos_lat

    r_m = math.sqrt(max(target_area_m2, 1.0) / math.pi)
    r_lat = r_m / m_per_deg_lat
    r_lon = r_m / m_per_deg_lon

    coords: list[list[float]] = []
    base_angle = random.random() * 2.0 * math.pi
    for i in range(n_vertices):
        ang = base_angle + (2.0 * math.pi * i / n_vertices)
        scale = random.uniform(0.7, 1.3)
        x = cx + r_lon * scale * math.cos(ang)
        y = cy + r_lat * scale * math.sin(ang)
        coords.append([x, y])
    coords.append(coords[0])
    return {"type": "Polygon", "coordinates": [coords]}


def _polygon_area_m2(geom: dict[str, Any]) -> float:
    """평면 근사 — engines mock 용."""
    ring = geom["coordinates"][0]
    if len(ring) < 4:
        return 0.0
    cy = sum(p[1] for p in ring) / len(ring)
    cos_lat = math.cos(math.radians(cy))
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * cos_lat
    area = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        area += (x1 * m_per_deg_lon) * (y2 * m_per_deg_lat) - (
            x2 * m_per_deg_lon
        ) * (y1 * m_per_deg_lat)
    return abs(area / 2.0)


def run(bbox: list[float], category: str) -> list[dict[str, Any]]:
    """mock 변화탐지: 카테고리별 분포에 따라 폴리곤 생성."""
    if len(bbox) != 4:
        raise ValueError("bbox must be [minLon, minLat, maxLon, maxLat]")
    bounds = (float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3]))

    dist = _DIST_BUILDING if category == "building" else _DIST_ROAD
    out: list[dict[str, Any]] = []
    for change_type, count, (area_min, area_max) in dist:
        for _ in range(count):
            area_target = random.uniform(area_min, area_max)
            n = random.randint(5, 8)
            poly = _random_polygon(bounds, area_target, n)
            out.append(
                {
                    "change_type": change_type,
                    "confidence": random.randint(45, 98),
                    "area_m2": round(_polygon_area_m2(poly), 2),
                    "geometry": poly,
                    "region_code": "",
                    "address": "",
                }
            )
    random.shuffle(out)
    return out
