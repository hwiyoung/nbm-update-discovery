"""공통 스키마 — Geometry / Bbox / Error."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, Field

# ============================================================
# GeoJSON Polygon (느슨한 검증 — 좌표 형식만)
# ============================================================

GeoJsonPolygon = dict[str, Any]
"""
{
  "type": "Polygon",
  "coordinates": [[[lon, lat], [lon, lat], ...]]
}
"""

BboxArray = Annotated[list[float], Field(min_length=4, max_length=4)]
"""[minLon, minLat, maxLon, maxLat] — EPSG:4326."""


# ============================================================
# 에러 응답 (BACKEND_API_SPEC §0.3)
# ============================================================


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


# ============================================================
# Health
# ============================================================


class HealthResponse(BaseModel):
    status: str = "ok"
