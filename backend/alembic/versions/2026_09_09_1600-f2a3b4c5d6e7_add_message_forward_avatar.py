"""Add forwarded sender avatar snapshot (аватар автора в «Переслано от …»)

Хранит снимок аватара автора оригинала на момент пересылки (как и имя),
чтобы плашка «Переслано от …» могла показать аватар и открыть чат с автором.

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-09-09 16:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, Sequence[str], None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("forwarded_sender_avatar_url", sa.String(length=2048), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("messages", "forwarded_sender_avatar_url")
