"""5186 ↔ 4326 좌표계 변환.

DB 표준은 EPSG:5186, API 응답은 EPSG:4326.
ST_Transform 을 SQLAlchemy Geometry 컬럼 위에서 사용하는 게 정석이지만,
스키마 → Pydantic 변환 단계에서 shapely + pyproj 으로 변환하는 헬퍼도 둔다.
"""

from __future__ import annotations

from typing import Any

from pyproj import Transformer
from shapely import wkb
from shapely.geometry import mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform

# 지속 가능한 Transformer 객체 (스레드 안전)
_TO_4326 = Transformer.from_crs(5186, 4326, always_xy=True)
_TO_5186 = Transformer.from_crs(4326, 5186, always_xy=True)


def to_4326(geom: BaseGeometry) -> BaseGeometry:
    return transform(_TO_4326.transform, geom)


def to_5186(geom: BaseGeometry) -> BaseGeometry:
    return transform(_TO_5186.transform, geom)


def wkb_to_geojson_4326(geom_wkb: bytes | str | None) -> dict[str, Any] | None:
    """PostGIS Geometry(EPSG:5186) WKB → GeoJSON(EPSG:4326)."""
    if geom_wkb is None:
        return None
    if isinstance(geom_wkb, str):
        geom = wkb.loads(bytes.fromhex(geom_wkb))
    else:
        geom = wkb.loads(geom_wkb)
    return mapping(to_4326(geom))


def geojson_4326_to_5186_wkt(gj: dict[str, Any]) -> str:
    """GeoJSON(EPSG:4326) → PostGIS WKT(EPSG:5186)."""
    geom = shape(gj)
    return to_5186(geom).wkt


def bbox_from_geometry(gj: dict[str, Any]) -> list[float]:
    """GeoJSON Polygon → [minLon, minLat, maxLon, maxLat]."""
    geom = shape(gj)
    minx, miny, maxx, maxy = geom.bounds
    return [minx, miny, maxx, maxy]
