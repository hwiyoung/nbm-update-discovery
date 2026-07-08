"""도엽 (MapSheet) 스키마 — frontend src/types/sheet.ts 1:1."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.common import BboxArray, GeoJsonPolygon

ReviewStatus = Literal["pending", "in_progress", "completed", "on_hold"]
CompareType = Literal["image-image"]
ObjectCategory = Literal["building", "road"]


class MapSheet(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    name: str
    region: str
    bbox: BboxArray
    geometry: GeoJsonPolygon
    area_km2: float

    review_status: ReviewStatus
    reviewer: str | None = None
    reviewed_at: datetime | None = None

    # 그리드 도엽 (task 미할당) 은 모두 NULL.
    task_id: str | None = None
    models: list[ObjectCategory] = []
    compare_type: CompareType | None = None
    standard_resource_id: int | None = None
    compare_resource_id: int | None = None

    f1_score: float | None = None
    precision: float | None = None
    recall: float | None = None

    total_detections: int = 0


class SheetStatusUpdate(BaseModel):
    """PATCH /sheets/{code}/status 페이로드."""

    status: ReviewStatus
