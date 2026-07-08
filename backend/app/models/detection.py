"""변화탐지 객체 (detections) 테이블."""

from __future__ import annotations

from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class DetectionORM(Base):
    __tablename__ = "detections"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sheet_code: Mapped[str] = mapped_column(
        String(8), ForeignKey("sheets.code", ondelete="CASCADE"), index=True, nullable=False
    )
    # 본 detection 이 속한 프로젝트. 동일 sheet 를 공유하는 다른 프로젝트와 격리.
    # 기존 import 데이터는 sheets.task_id 로 backfill 됨. 새 worker / endpoint 에서는
    # 반드시 명시적으로 채워야 list_task_detections 에 노출됨.
    task_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    # AI 결과 (불변)
    model: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    change_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    area_m2: Mapped[float] = mapped_column(Float, nullable=False)
    geometry: Mapped[bytes] = mapped_column(
        Geometry(geometry_type="POLYGON", srid=5186, spatial_index=True)
    )
    region_code: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    address: Mapped[str] = mapped_column(String(256), nullable=False, default="")

    # 처리 결과 (가변)
    error_class: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    reviewer_memo: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    reviewed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    is_user_added: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
