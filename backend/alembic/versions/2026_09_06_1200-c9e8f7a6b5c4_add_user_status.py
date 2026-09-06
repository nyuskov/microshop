"""Add status to user table

Revision ID: c9e8f7a6b5c4
Revises: 9f3a2b6c4d01
Create Date: 2026-09-06 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9e8f7a6b5c4"
down_revision: Union[str, Sequence[str], None] = "9f3a2b6c4d01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Текст-статус пользователя (виден в шапке личного чата и в профиле).
    op.add_column(
        "user", sa.Column("status", sa.String(length=140), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("user", "status")
