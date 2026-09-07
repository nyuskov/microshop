"""Add message forwarding fields (пересылка: «переслано от …»)

Добавляет в messages ссылку на исходное сообщение и снимок отправителя
(имя/чат), чтобы показывать плашку «Переслано от …» даже после удаления
оригинала.

Revision ID: f0e1d2c3b4a5
Revises: f6a7b8c9d0e1
Create Date: 2026-09-07 18:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f0e1d2c3b4a5"
down_revision: Union[str, Sequence[str], None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column(
            "forwarded_from_id",
            sa.Integer(),
            sa.ForeignKey("messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "messages",
        sa.Column(
            "forwarded_sender_id",
            sa.Integer(),
            sa.ForeignKey("user.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "messages",
        sa.Column("forwarded_sender_name", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "messages",
        sa.Column(
            "forwarded_chat_id",
            sa.Integer(),
            sa.ForeignKey("chats.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("messages", "forwarded_chat_id")
    op.drop_column("messages", "forwarded_sender_name")
    op.drop_column("messages", "forwarded_sender_id")
    op.drop_column("messages", "forwarded_from_id")
