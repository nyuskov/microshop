"""Кэш карточек внешних ссылок (превью ссылок в сообщениях)

Revision ID: b1c2d3e4f5a6
Revises: f7a8b9c0d1e2
Create Date: 2026-09-11 12:00

Одна строка на адрес: заголовок, описание, домен, ссылка на скачанную к нам
картинку и отметка времени (успешные карточки живут неделю, неудачные — час).
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "f7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Создаёт таблицу кэша превью ссылок."""
    op.create_table(
        "link_previews",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=True),
        sa.Column("description", sa.String(length=600), nullable=True),
        sa.Column("site_name", sa.String(length=120), nullable=True),
        sa.Column("image_url", sa.String(length=255), nullable=True),
        sa.Column("ok", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_link_previews_url"), "link_previews", ["url"], unique=True)


def downgrade() -> None:
    """Удаляет таблицу кэша превью ссылок."""
    op.drop_index(op.f("ix_link_previews_url"), table_name="link_previews")
    op.drop_table("link_previews")
