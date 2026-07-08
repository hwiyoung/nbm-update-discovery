"""allow base sheet grid rows without task references

Revision ID: 0005_sheet_seed_nullable_refs
Revises: 0004_task_started_at
Create Date: 2026-06-02
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_sheet_seed_nullable_refs"
down_revision: Union[str, None] = "0004_task_started_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("sheets", "task_id", existing_type=sa.String(64), nullable=True)
    op.alter_column("sheets", "models", existing_type=sa.ARRAY(sa.String()), nullable=True)
    op.alter_column("sheets", "compare_type", existing_type=sa.String(16), nullable=True)
    op.alter_column("sheets", "standard_resource_id", existing_type=sa.Integer(), nullable=True)
    op.alter_column("sheets", "compare_resource_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE sheets SET task_id = '' WHERE task_id IS NULL")
    op.execute("UPDATE sheets SET models = '{}' WHERE models IS NULL")
    op.execute("UPDATE sheets SET compare_type = 'image-image' WHERE compare_type IS NULL")
    op.execute("UPDATE sheets SET standard_resource_id = 0 WHERE standard_resource_id IS NULL")
    op.execute("UPDATE sheets SET compare_resource_id = 0 WHERE compare_resource_id IS NULL")
    op.alter_column("sheets", "compare_resource_id", existing_type=sa.Integer(), nullable=False)
    op.alter_column("sheets", "standard_resource_id", existing_type=sa.Integer(), nullable=False)
    op.alter_column("sheets", "compare_type", existing_type=sa.String(16), nullable=False)
    op.alter_column("sheets", "models", existing_type=sa.ARRAY(sa.String()), nullable=False)
    op.alter_column("sheets", "task_id", existing_type=sa.String(64), nullable=False)
