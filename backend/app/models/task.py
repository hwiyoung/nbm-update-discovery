"""변화탐지 작업 (tasks) 테이블."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    ARRAY,
    DateTime,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TaskORM(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    models: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    compare_type: Mapped[str] = mapped_column(String(16), nullable=False, default="image-image")
    # 수동 import (외부 결과 GeoJSON 등) 시 NULL 허용.
    standard_resource_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    compare_resource_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    standard_resource_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer), nullable=False, default=list)
    compare_resource_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer), nullable=False, default=list)

    sheet_codes: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    celery_task_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
