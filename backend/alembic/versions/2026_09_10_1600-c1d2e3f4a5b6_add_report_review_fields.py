"""Add report review fields (note, reviewed_at)

Разбор жалоб через служебные эндпоинты модератора: заметка по итогам
разбора и метка времени, когда жалобу перестали считать новой.

Revision ID: c1d2e3f4a5b6
Revises: b0c1d2e3f4a5
Create Date: 2026-09-10 16:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, Sequence[str], None] = "b0c1d2e3f4a5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_reports",
        sa.Column("note", sa.String(length=1000), nullable=True),
    )
    op.add_column(
        "user_reports",
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_user_reports_status_created_at",
        "user_reports",
        ["status", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_user_reports_status_created_at", table_name="user_reports")
    op.drop_column("user_reports", "reviewed_at")
    op.drop_column("user_reports", "note")
