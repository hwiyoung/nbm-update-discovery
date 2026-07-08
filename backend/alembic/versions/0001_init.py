"""init — PostGIS 확장 + 5 테이블

Revision ID: 0001
Revises:
Create Date: 2026-05-07
"""

from __future__ import annotations

from typing import Sequence, Union

import geoalchemy2  # noqa: F401  (Geometry 타입 등록)
import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostGIS 확장 활성화
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis;")

    # ---- sheets ----
    op.create_table(
        "sheets",
        sa.Column("code", sa.String(8), primary_key=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("region", sa.String(32), nullable=False, index=True),
        sa.Column(
            "geometry",
            Geometry(geometry_type="POLYGON", srid=5186, spatial_index=True),
            nullable=False,
        ),
        sa.Column("area_km2", sa.Float, nullable=False, server_default="0"),
        sa.Column("review_status", sa.String(16), nullable=False, server_default="pending", index=True),
        sa.Column("reviewer", sa.String(64), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("task_id", sa.String(64), nullable=True, index=True),
        sa.Column("models", sa.ARRAY(sa.String), nullable=True, server_default="{}"),
        sa.Column("compare_type", sa.String(16), nullable=True, server_default="image-image"),
        sa.Column("standard_resource_id", sa.Integer, nullable=True),
        sa.Column("compare_resource_id", sa.Integer, nullable=True),
        sa.Column("f1_score", sa.Float, nullable=True),
        sa.Column("precision", sa.Float, nullable=True),
        sa.Column("recall", sa.Float, nullable=True),
        sa.Column("total_detections", sa.Integer, nullable=False, server_default="0"),
        sa.Column("reviewed_detections", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tp_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("fp_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("fn_count", sa.Integer, nullable=False, server_default="0"),
    )

    # ---- detections ----
    op.create_table(
        "detections",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "sheet_code",
            sa.String(8),
            sa.ForeignKey("sheets.code", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("model", sa.String(16), nullable=False, index=True),
        sa.Column("change_type", sa.String(32), nullable=False, index=True),
        sa.Column("confidence", sa.Float, nullable=False),
        sa.Column("area_m2", sa.Float, nullable=False),
        sa.Column(
            "geometry",
            Geometry(geometry_type="POLYGON", srid=5186, spatial_index=True),
            nullable=False,
        ),
        sa.Column("region_code", sa.String(16), nullable=False, server_default=""),
        sa.Column("address", sa.String(256), nullable=False, server_default=""),
        sa.Column("error_class", sa.String(16), nullable=True, index=True),
        sa.Column("reviewer_memo", sa.String(128), nullable=False, server_default=""),
        sa.Column("reviewed_by", sa.String(64), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_user_added", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("is_deleted", sa.Boolean, nullable=False, server_default=sa.text("false"), index=True),
    )

    # ---- datasets ----
    op.create_table(
        "datasets",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("source", sa.String(16), nullable=False, server_default="upload"),
        sa.Column("display_name", sa.String(256), nullable=False),
        sa.Column("platform", sa.String(16), nullable=False, server_default=""),
        sa.Column("taken_start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("taken_end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "bbox",
            Geometry(geometry_type="POLYGON", srid=5186, spatial_index=True),
            nullable=False,
        ),
        sa.Column("tile_path", sa.String(512), nullable=True),
        sa.Column("sheet_codes", sa.ARRAY(sa.String), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("thumbnail_url", sa.String(512), nullable=True),
        sa.Column("size_bytes", sa.BigInteger, nullable=True),
    )

    # ---- review_histories ----
    op.create_table(
        "review_histories",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("object_id", sa.String(64), nullable=False, index=True),
        sa.Column(
            "sheet_code",
            sa.String(8),
            sa.ForeignKey("sheets.code", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("model", sa.String(16), nullable=False),
        sa.Column("change_type", sa.String(32), nullable=False),
        sa.Column(
            "geometry",
            Geometry(geometry_type="POLYGON", srid=5186),
            nullable=False,
        ),
        sa.Column("action", sa.String(16), nullable=False, index=True),
        sa.Column("before", sa.JSON, nullable=True),
        sa.Column("after", sa.JSON, nullable=True),
        sa.Column("reviewer", sa.String(64), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("memo", sa.Text, nullable=True),
    )

    # ---- tasks ----
    op.create_table(
        "tasks",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("models", sa.ARRAY(sa.String), nullable=False, server_default="{}"),
        sa.Column("compare_type", sa.String(16), nullable=False, server_default="image-image"),
        sa.Column("standard_resource_id", sa.Integer, nullable=True),
        sa.Column("compare_resource_id", sa.Integer, nullable=True),
        sa.Column("sheet_codes", sa.ARRAY(sa.String), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending", index=True),
        sa.Column("progress", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("celery_task_id", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("tasks")
    op.drop_table("review_histories")
    op.drop_table("datasets")
    op.drop_table("detections")
    op.drop_table("sheets")
    # PostGIS 확장은 유지 (다른 DB 객체에서 쓸 수 있음)
