"""데이터셋 스키마.

PROMPTS §1 결정으로 type 필드 없음 (수치지도 비교는 별도 플랫폼).
source 필드로 기원 구분만.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import GeoJsonPolygon

DatasetSource = Literal["upload", "aerial", "external"]
DatasetStatus = Literal["pending", "processing", "ready", "failed"]


class Dataset(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source: DatasetSource
    display_name: str
    platform: str
    taken_start_at: datetime
    taken_end_at: datetime
    bbox: GeoJsonPolygon
    tile_path: str | None = None
    sheet_codes: list[str] = Field(default_factory=list)
    status: DatasetStatus
    thumbnail_url: str | None = None
    size_bytes: int | None = None


class DatasetUploadMeta(BaseModel):
    """업로드 모달 메타."""

    display_name: str
    platform: str
    taken_start_at: datetime
    taken_end_at: datetime


class DatasetCreate(DatasetUploadMeta):
    """POST /datasets (이정표 5)."""

    bbox: GeoJsonPolygon
    sheet_codes: list[str] = Field(default_factory=list)
    tile_path: str | None = None


class DatasetStatusUpdate(BaseModel):
    """PATCH /datasets/{id}/status."""

    status: DatasetStatus


class DatasetFilterQuery(BaseModel):
    """GET /datasets 쿼리 파라미터 (선택)."""

    source: DatasetSource | None = None
    status: DatasetStatus | None = None
    platform: str | None = None


class OverlapResult(BaseModel):
    """GET /datasets/overlap."""

    ratio: float
    common_sheets: list[str]


class DatasetPreflightWarning(BaseModel):
    """Preflight warning shown before change-detection execution."""

    code: str
    severity: Literal["warning", "strong"]
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class DatasetPreflightRaster(BaseModel):
    """Raster metadata derived during preflight."""

    dataset_id: int
    path: str
    crs: str
    width: int
    height: int
    band_count: int
    gsd_x_m: float
    gsd_y_m: float
    mean_gsd_m: float
    footprint_area_m2: float
    footprint_method: str
    valid_pixel_count: int


class DatasetPreflightResult(BaseModel):
    """GET /datasets/preflight."""

    standard: DatasetPreflightRaster
    compare: DatasetPreflightRaster
    target_gsd_m: float
    intersection_area_m2: float
    overlap_ratio: float
    overlap_method: str
    intersection_bounds_5186: list[float] | None = None
    can_proceed: bool
    warnings: list[DatasetPreflightWarning] = Field(default_factory=list)
