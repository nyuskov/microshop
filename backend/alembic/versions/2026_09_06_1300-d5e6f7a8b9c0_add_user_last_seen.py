"""Add last_seen to user table

Revision ID: d5e6f7a8b9c0
Revises: c9e8f7a6b5c4
Create Date: 2026-09-06 13:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5e6f7a8b9c0"
down_revision: Union[str, Sequence[str], None] = "c9e8f7a6b5c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Время последней активности: по нему фронт показывает «в сети» / «был(а) N назад».
    op.add_column(
        "user",
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user", "last_seen")
