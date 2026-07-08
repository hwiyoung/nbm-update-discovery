"""처리 이력 (review_histories) 테이블."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import JSON, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ReviewHistoryORM(Base):
    __tablename__ = "review_histories"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    object_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    sheet_code: Mapped[str] = mapped_column(
        String(8), ForeignKey("sheets.code", ondelete="CASCADE"), nullable=False, index=True
    )
    # 본 이력이 속한 프로젝트. 같은 sheet 를 공유하는 두 프로젝트가 동일한 처리
    # 히스토리를 보지 않도록 task_id 로 격리. legacy 행은 NULL — fallback 으로
    # sheet_code 매칭하여 노출.
    task_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    model: Mapped[str] = mapped_column(String(16), nullable=False)
    change_type: Mapped[str] = mapped_column(String(32), nullable=False)
    geometry: Mapped[bytes] = mapped_column(
        Geometry(geometry_type="POLYGON", srid=5186)
    )

    action: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    before: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    reviewer: Mapped[str] = mapped_column(String(64), nullable=False)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
