"""Аватары: миниатюры 128px для списков чатов и шапок

Пользователи и группы показывают аватар в маленьком размере (40-56px), а в
списках чатов — на каждый чат. Оригинал (до 5 МБ) для этого не нужен: рядом с
оригиналом храним уменьшенную копию и отдаём клиенту её.

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-09-12 16:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d8e9f0a1b2c3"
down_revision: Union[str, None] = "c7d8e9f0a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column("avatar_thumb_url", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "chats",
        sa.Column("avatar_thumb_url", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("chats", "avatar_thumb_url")
    op.drop_column("user", "avatar_thumb_url")
