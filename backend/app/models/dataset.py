"""데이터셋 (datasets) 테이블."""

from __future__ import annotations

from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import (
    ARRAY,
    BigInteger,
    DateTime,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class DatasetORM(Base):
    __tablename__ = "datasets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="upload")
    display_name: Mapped[str] = mapped_column(String(256), nullable=False)
    platform: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    taken_start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    taken_end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    bbox: Mapped[bytes] = mapped_column(
        Geometry(geometry_type="POLYGON", srid=5186, spatial_index=True)
    )
    tile_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    sheet_codes: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    thumbnail_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
