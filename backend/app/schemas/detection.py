"""변화탐지 객체 스키마."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.common import GeoJsonPolygon
from app.schemas.sheet import ObjectCategory

ChangeType = Literal[
    "building_new",
    "building_removed",
    "building_updated",
    "road_new",
    "road_removed",
    "road_updated",
]


class DetectionObject(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    sheet_code: str
    # 본 detection 이 속한 프로젝트. legacy 데이터(import 전) 는 None — list_task_detections
    # 에서 제외됨. worker / API 가 detection 생성 시 반드시 채워야 함.
    task_id: str | None = None

    model: ObjectCategory
    change_type: ChangeType
    confidence: float
    area_m2: float
    geometry: GeoJsonPolygon
    region_code: str
    address: str

    reviewer_memo: str = ""
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None

    is_user_added: bool = False
    is_deleted: bool = False


class DetectionUpdatePayload(BaseModel):
    """PATCH /detections/{id}."""

    reviewer_memo: str | None = None
    geometry: GeoJsonPolygon | None = None
    is_deleted: bool | None = None
    # 사용자가 객체 카테고리·변화 유형을 수정 (편집 모드 UI).
    model: ObjectCategory | None = None
    change_type: ChangeType | None = None


class DetectionCreatePayload(BaseModel):
    """POST /sheets/{code}/detections."""

    model: ObjectCategory
    change_type: ChangeType
    confidence: float
    area_m2: float
    geometry: GeoJsonPolygon
    region_code: str = ""
    address: str = ""
    reviewer_memo: str = ""
