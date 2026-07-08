"""detections.task_id — 프로젝트 단위 격리 (engine 통합 전 데이터 정합성)

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-13

같은 sheet 를 공유하는 두 프로젝트가 동일한 detection 을 끌어가던 버그 해소.
DetectionORM.task_id (nullable, indexed) 추가 + sheet.task_id 기준 backfill.

Backfill 정책:
  1. detections.task_id := sheets.task_id (sheet 의 owning task 가 있을 때만)
  2. review_histories.task_id := detections.task_id (object_id 매칭, NULL 인 행만)

이후 list_task_detections / list_task_history 는 task_id 로 엄격 필터하며,
NULL fallback 은 사용하지 않음 (legacy NULL 데이터는 어느 프로젝트에도 노출 안됨).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "detections",
        sa.Column("task_id", sa.String(64), nullable=True),
    )
    op.create_index("ix_detections_task_id", "detections", ["task_id"])

    # 1) sheets.task_id → detections.task_id (1 sheet = 1 owning task 가정)
    op.execute(
        """
        UPDATE detections d
           SET task_id = s.task_id
          FROM sheets s
         WHERE d.sheet_code = s.code
           AND s.task_id IS NOT NULL
           AND d.task_id IS NULL
        """
    )

    # 2) detections.task_id → review_histories.task_id (object_id 매칭)
    op.execute(
        """
        UPDATE review_histories h
           SET task_id = d.task_id
          FROM detections d
         WHERE h.object_id = d.id
           AND d.task_id IS NOT NULL
           AND h.task_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_detections_task_id", table_name="detections")
    op.drop_column("detections", "task_id")
