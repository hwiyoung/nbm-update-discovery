"""처리 이력 스키마."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.common import GeoJsonPolygon
from app.schemas.detection import ChangeType
from app.schemas.sheet import ObjectCategory

HistoryAction = Literal[
    "classify",
    "edit_geometry",
    "edit_meta",
    "create",
    "delete",
    "restore",
]


class ReviewHistory(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    object_id: str
    sheet_code: str
    # 본 이력이 속한 프로젝트(=task). legacy 행은 None — sheet_code fallback 으로 노출.
    task_id: str | None = None
    model: ObjectCategory
    change_type: ChangeType
    geometry: GeoJsonPolygon

    action: HistoryAction
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None

    reviewer: str
    reviewed_at: datetime
    memo: str | None = None
