"""allow tasks without dataset references after cleanup

Revision ID: 0006_task_resource_nullable_refs
Revises: 0005_sheet_seed_nullable_refs
Create Date: 2026-06-02
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_task_resource_nullable_refs"
down_revision: Union[str, None] = "0005_sheet_seed_nullable_refs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("tasks", "standard_resource_id", existing_type=sa.Integer(), nullable=True)
    op.alter_column("tasks", "compare_resource_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE tasks SET standard_resource_id = 0 WHERE standard_resource_id IS NULL")
    op.execute("UPDATE tasks SET compare_resource_id = 0 WHERE compare_resource_id IS NULL")
    op.alter_column("tasks", "compare_resource_id", existing_type=sa.Integer(), nullable=False)
    op.alter_column("tasks", "standard_resource_id", existing_type=sa.Integer(), nullable=False)
