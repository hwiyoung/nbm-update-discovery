"""add multi resource id arrays to tasks

Revision ID: 0007_task_multi_resource_ids
Revises: 0006_task_resource_nullable_refs
Create Date: 2026-07-09
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007_task_multi_resource_ids"
down_revision: Union[str, None] = "0006_task_resource_nullable_refs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column(
            "standard_resource_ids",
            sa.ARRAY(sa.Integer()),
            nullable=False,
            server_default="{}",
        ),
    )
    op.add_column(
        "tasks",
        sa.Column(
            "compare_resource_ids",
            sa.ARRAY(sa.Integer()),
            nullable=False,
            server_default="{}",
        ),
    )
    op.execute(
        """
        UPDATE tasks
        SET standard_resource_ids = ARRAY[standard_resource_id]
        WHERE standard_resource_id IS NOT NULL
          AND cardinality(standard_resource_ids) = 0
        """
    )
    op.execute(
        """
        UPDATE tasks
        SET compare_resource_ids = ARRAY[compare_resource_id]
        WHERE compare_resource_id IS NOT NULL
          AND cardinality(compare_resource_ids) = 0
        """
    )


def downgrade() -> None:
    op.drop_column("tasks", "compare_resource_ids")
    op.drop_column("tasks", "standard_resource_ids")
