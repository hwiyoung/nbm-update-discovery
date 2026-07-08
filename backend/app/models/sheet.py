"""도엽 (sheets) 테이블."""

from __future__ import annotations

from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import (
    ARRAY,
    DateTime,
    Float,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MapSheetORM(Base):
    __tablename__ = "sheets"

    code: Mapped[str] = mapped_column(String(8), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    region: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    geometry: Mapped[bytes] = mapped_column(
        Geometry(geometry_type="POLYGON", srid=5186, spatial_index=True)
    )
    area_km2: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    # 처리 상태
    review_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", index=True
    )
    reviewer: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # 작업 메타 — 17K 그리드 시드 시점에는 NULL. task 가 등록되며 채워짐.
    task_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    models: Mapped[list[str] | None] = mapped_column(ARRAY(String), nullable=True)
    compare_type: Mapped[str | None] = mapped_column(String(16), nullable=True, default="image-image")
    standard_resource_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    compare_resource_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # 메트릭 (처리 결과 기반)
    f1_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    precision: Mapped[float | None] = mapped_column(Float, nullable=True)
    recall: Mapped[float | None] = mapped_column(Float, nullable=True)

    # 통계
    total_detections: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reviewed_detections: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tp_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    fp_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    fn_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
