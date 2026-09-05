"""Add message extras (reply, read, pin, file) and reactions table

Revision ID: ee0f5b7a9c21
Revises: fedcba654321
Create Date: 2026-09-05 15:30:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ee0f5b7a9c21"
down_revision: Union[str, Sequence[str], None] = "fedcba654321"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Расширяем таблицу messages
    op.add_column(
        "messages",
        sa.Column(
            "reply_to_id",
            sa.Integer(),
            sa.ForeignKey("messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "messages",
        sa.Column(
            "is_read",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "messages",
        sa.Column(
            "is_pinned",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "messages", sa.Column("file_name", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "messages", sa.Column("file_url", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "messages", sa.Column("mime_type", sa.String(length=120), nullable=True)
    )
    op.add_column(
        "messages", sa.Column("file_size", sa.Integer(), nullable=True)
    )
    op.create_index(
        op.f("ix_messages_reply_to_id"),
        "messages",
        ["reply_to_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_messages_is_pinned"), "messages", ["is_pinned"], unique=False
    )

    # Таблица реакций на сообщения
    op.create_table(
        "message_reactions",
        sa.Column("message_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("emoji", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["message_id"], ["messages.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("message_id", "user_id"),
    )
    op.create_index(
        op.f("ix_message_reactions_message_id"),
        "message_reactions",
        ["message_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_message_reactions_message_id"),
        table_name="message_reactions",
    )
    op.drop_table("message_reactions")

    op.drop_index(op.f("ix_messages_is_pinned"), table_name="messages")
    op.drop_index(op.f("ix_messages_reply_to_id"), table_name="messages")
    op.drop_column("messages", "file_size")
    op.drop_column("messages", "mime_type")
    op.drop_column("messages", "file_url")
    op.drop_column("messages", "file_name")
    op.drop_column("messages", "is_pinned")
    op.drop_column("messages", "is_read")
    op.drop_column("messages", "reply_to_id")
