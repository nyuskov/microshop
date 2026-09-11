"""Обёртки ключа группы (E2EE для групп)

Таблица ``chat_group_keys``: по строке на участника — ключ группы, зашифрованный
на общем секрете ECDH между раздавшим (``wrapped_by``) и получателем. Сервер
хранит только шифротекст и не может прочитать групповую переписку.

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-09-11 13:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c2d3e4f5a6b7"
down_revision: Union[str, Sequence[str], None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Создаёт таблицу обёрток ключа группы."""
    op.create_table(
        "chat_group_keys",
        sa.Column("chat_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("wrapped_key", sa.Text(), nullable=False),
        sa.Column("wrapped_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["wrapped_by"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("chat_id", "user_id"),
    )
    op.create_index(
        "ix_chat_group_keys_chat_id",
        "chat_group_keys",
        ["chat_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_chat_group_keys_chat_id", table_name="chat_group_keys")
    op.drop_table("chat_group_keys")
