"""history.task_id — 프로젝트 단위 격리

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-13

같은 sheet 를 공유하는 두 프로젝트가 동일한 처리 히스토리를 보던 버그 해소.
ReviewHistoryORM 에 task_id (nullable) 추가. legacy 행은 NULL — list_task_history
에서 sheet_code fallback 으로 노출하여 데이터 손실 없음.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "review_histories",
        sa.Column("task_id", sa.String(64), nullable=True),
    )
    op.create_index(
        "ix_review_histories_task_id",
        "review_histories",
        ["task_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_review_histories_task_id", table_name="review_histories")
    op.drop_column("review_histories", "task_id")
