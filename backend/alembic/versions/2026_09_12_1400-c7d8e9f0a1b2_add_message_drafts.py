"""Add message_drafts table

Черновики сообщений: одна строка на пару (пользователь, чат). Текст — то же,
что уходит в сообщение (в чате со сквозным шифрованием это шифротекст), поэтому
колонка Text. Каскадное удаление при удалении пользователя или чата.

Revision ID: c7d8e9f0a1b2
Revises: f8b9c0d1e2f3
Create Date: 2026-09-12 14:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7d8e9f0a1b2"
down_revision: Union[str, Sequence[str], None] = "f8b9c0d1e2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "message_drafts",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("chat_id", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "chat_id"),
    )


def downgrade() -> None:
    op.drop_table("message_drafts")
