"""변화탐지 작업 스키마."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.sheet import CompareType, ObjectCategory

TaskStatus = Literal[
    "pending",
    "running",
    "succeeded",
    "failed",
    "canceled",
]


class Task(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str
    models: list[ObjectCategory]
    compare_type: CompareType
    standard_resource_id: int | None = None
    compare_resource_id: int | None = None

    sheet_codes: list[str] = Field(default_factory=list)
    status: TaskStatus
    progress: int = 0
    progress_message: str | None = None
    progress_stage: str | None = None
    progress_detail: dict[str, Any] | None = None
    progress_updated_at: datetime | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    celery_task_id: str | None = None

    # 실시간 detection 카운트 — DB COUNT(detections WHERE task_id=id AND NOT is_deleted).
    # serializer 가 호출 시점에 채움. sheets.total_detections 합산이 아닌 단일 진실 원천.
    detection_count: int = 0


class TaskCreatePayload(BaseModel):
    name: str
    description: str = ""
    models: list[ObjectCategory]
    compare_type: CompareType = "image-image"
    standard_resource_id: int
    compare_resource_id: int
    auto_run: bool = True
    """True (기본): 등록 직후 Celery enqueue. False: 작업 row 만 생성, 추후 수동 시작."""


class TaskUpdatePayload(BaseModel):
    """PATCH /tasks/{id} — 부분 수정. None 인 필드는 변경 없음."""
    name: str | None = None
    description: str | None = None
    standard_resource_id: int | None = None
    compare_resource_id: int | None = None
    models: list[ObjectCategory] | None = None
