"""Каналы: посты одного автора, подписчики, комментарии, предложенные посты

Канал — это обычный чат (`chats.is_channel`), поэтому роли участников,
приглашения, непрочитанные, вложения, реакции и push-уведомления работают без
изменений. Публичный канал получает адрес `/c/<channel_username>` и находится в
поиске; у приватного адреса нет — вход только по ссылке-приглашению.

Отдельные таблицы нужны только там, где канал отличается от чата:
комментарии под постами, просмотры постов и «предложить пост» от подписчиков.

Revision ID: f0a1b2c3d4e5
Revises: e9f0a1b2c3d4
Create Date: 2026-09-12 20:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f0a1b2c3d4e5"
down_revision: Union[str, None] = "e9f0a1b2c3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Признаки канала у обычного чата ---
    op.add_column(
        "chats",
        sa.Column("is_channel", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "chats",
        sa.Column("channel_username", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "chats",
        sa.Column("is_public", sa.Boolean(), server_default="false", nullable=False),
    )
    op.create_index(
        "ix_chats_channel_username", "chats", ["channel_username"], unique=True
    )

    # --- Комментарии под постами канала ---
    op.create_table(
        "channel_comments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("chat_id", sa.Integer(), nullable=False),
        sa.Column("message_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_channel_comments_chat_id", "channel_comments", ["chat_id"])
    op.create_index(
        "ix_channel_comments_message_id", "channel_comments", ["message_id"]
    )

    # --- Просмотры постов (одна строка на пару пост+подписчик) ---
    op.create_table(
        "channel_post_views",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("message_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", "user_id", name="uq_channel_post_views"),
    )
    op.create_index(
        "ix_channel_post_views_message_id", "channel_post_views", ["message_id"]
    )

    # --- Предложенные подписчиками посты ---
    op.create_table(
        "channel_suggestions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("chat_id", sa.Integer(), nullable=False),
        sa.Column("author_id", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=16),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("message_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_channel_suggestions_chat_id", "channel_suggestions", ["chat_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_channel_suggestions_chat_id", table_name="channel_suggestions")
    op.drop_table("channel_suggestions")
    op.drop_index("ix_channel_post_views_message_id", table_name="channel_post_views")
    op.drop_table("channel_post_views")
    op.drop_index("ix_channel_comments_message_id", table_name="channel_comments")
    op.drop_index("ix_channel_comments_chat_id", table_name="channel_comments")
    op.drop_table("channel_comments")
    op.drop_index("ix_chats_channel_username", table_name="chats")
    op.drop_column("chats", "is_public")
    op.drop_column("chats", "channel_username")
    op.drop_column("chats", "is_channel")
