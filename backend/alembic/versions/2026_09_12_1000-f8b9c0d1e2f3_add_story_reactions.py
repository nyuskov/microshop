"""Реакции на истории: таблица ``story_reactions``

Revision ID: f8b9c0d1e2f3
Revises: e4f5a6b7c8d9
Create Date: 2026-09-12 10:00

Одна реакция = один эмодзи от одного зрителя. Уникальность тройки
(story_id, user_id, emoji) не даёт поставить один и тот же эмодзи дважды
(повторный запрос при повторе сети ничего не испортит), но разрешает разные —
как в Telegram Stories. Реакции удаляются вместе с историей и с аккаунтом.

Данные не переносим: у существующих историй реакций просто нет.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f8b9c0d1e2f3"
down_revision: Union[str, None] = "e4f5a6b7c8d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Создаёт таблицу реакций на истории."""
    op.create_table(
        "story_reactions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("story_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("emoji", sa.String(length=16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "story_id", "user_id", "emoji", name="uq_story_reactions_story_user_emoji"
        ),
    )
    op.create_index(
        op.f("ix_story_reactions_story_id"),
        "story_reactions",
        ["story_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_story_reactions_user_id"), "story_reactions", ["user_id"], unique=False
    )


def downgrade() -> None:
    """Удаляет таблицу реакций (истории и просмотры не трогаем)."""
    op.drop_index(op.f("ix_story_reactions_user_id"), table_name="story_reactions")
    op.drop_index(op.f("ix_story_reactions_story_id"), table_name="story_reactions")
    op.drop_table("story_reactions")
