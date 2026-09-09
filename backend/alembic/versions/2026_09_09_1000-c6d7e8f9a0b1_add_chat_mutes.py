"""Add chat_mutes table

«Замьюченные» чаты: пользователь отключил уведомления (Web Push + всплывающие
в приложении) о новых сообщениях конкретного чата. Составной первичный ключ
(user_id, chat_id), каскадное удаление при удалении пользователя/чата.

Revision ID: c6d7e8f9a0b1
Revises: b5c6d7e8f9a0
Create Date: 2026-09-09 10:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c6d7e8f9a0b1"
down_revision: Union[str, Sequence[str], None] = "b5c6d7e8f9a0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "chat_mutes",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("chat_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "chat_id"),
    )
    op.create_index(
        "ix_chat_mutes_chat_id",
        "chat_mutes",
        ["chat_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_chat_mutes_chat_id", table_name="chat_mutes")
    op.drop_table("chat_mutes")
