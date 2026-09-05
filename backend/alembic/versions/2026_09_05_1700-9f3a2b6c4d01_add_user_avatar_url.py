"""Add avatar_url to user table

Revision ID: 9f3a2b6c4d01
Revises: ee0f5b7a9c21
Create Date: 2026-09-05 17:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9f3a2b6c4d01"
down_revision: Union[str, Sequence[str], None] = "ee0f5b7a9c21"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user", sa.Column("avatar_url", sa.String(length=255), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("user", "avatar_url")
