"""Ответ на историю: ``messages.reply_to_story_id`` и снимок медиа

Revision ID: d7e8f9a0b1c2
Revises: c5d6e7f8a9b0
Create Date: 2026-09-17 14:00

Ответ на историю — это обычное сообщение в личном чате автора, но с пометкой
«ответ на историю»: в переписке над текстом рисуется плашка с превью. Ссылка на
историю живёт как FK (``ON DELETE SET NULL``: история удаляется через сутки, а
сообщение остаётся), а медиа-снимок хранится рядом — как снимок отправителя у
пересланных сообщений — чтобы плашка не «ослепла» после удаления истории.

Данные не переносим: у существующих сообщений ответов на истории нет.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7e8f9a0b1c2"
down_revision: Union[str, None] = "c5d6e7f8a9b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Добавляет поля ответа на историю в сообщения."""
    op.add_column(
        "messages",
        sa.Column("reply_to_story_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "messages",
        sa.Column("reply_to_story_media_url", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "messages",
        sa.Column("reply_to_story_mime_type", sa.String(length=120), nullable=True),
    )
    op.create_foreign_key(
        "fk_messages_reply_to_story_id",
        "messages",
        "stories",
        ["reply_to_story_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    """Убирает поля ответа на историю."""
    op.drop_constraint("fk_messages_reply_to_story_id", "messages", type_="foreignkey")
    op.drop_column("messages", "reply_to_story_mime_type")
    op.drop_column("messages", "reply_to_story_media_url")
    op.drop_column("messages", "reply_to_story_id")
