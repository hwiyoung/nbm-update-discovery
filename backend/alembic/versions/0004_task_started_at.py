"""add task started_at

Revision ID: 0004_task_started_at
Revises: 0003_detection_task_id
Create Date: 2026-06-02
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "0004_task_started_at"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("tasks")}
    if "started_at" not in columns:
        op.add_column("tasks", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("tasks")}
    if "started_at" in columns:
        op.drop_column("tasks", "started_at")
