"""moderation journal and message hiding

Две части одного требования (магазины приложений с UGC):
1) `messages.hidden_at` / `hidden_reason` — чтобы автоматика (3 жалобы от разных
   пользователей) и модератор могли скрыть контент до разбора; сообщение видит
   только автор (с пометкой «скрыто до проверки»).
2) `moderation_actions` — журнал: кто (или автомат), когда, что и по какой причине
   сделал. Append-only, без внешних ключей на удаление объектов.

Revision ID: f2b3c4d5e6a7
Revises: e1a2b3c4d5e6
Create Date: 2026-09-10 17:10:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2b3c4d5e6a7"
down_revision: Union[str, Sequence[str], None] = "e1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Добавляет скрытие сообщений и журнал модерации."""
    op.add_column(
        "messages",
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "messages",
        sa.Column("hidden_reason", sa.String(length=255), nullable=True),
    )
    op.create_index(
        op.f("ix_messages_hidden_at"),
        "messages",
        ["hidden_at"],
        unique=False,
    )

    op.create_table(
        "moderation_actions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("moderator_id", sa.Integer(), nullable=True),
        sa.Column("target_user_id", sa.Integer(), nullable=True),
        sa.Column("report_id", sa.Integer(), nullable=True),
        sa.Column("message_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["moderator_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["target_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["report_id"], ["user_reports.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_moderation_actions_action"),
        "moderation_actions",
        ["action"],
        unique=False,
    )
    op.create_index(
        op.f("ix_moderation_actions_created_at"),
        "moderation_actions",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_moderation_actions_moderator_id"),
        "moderation_actions",
        ["moderator_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_moderation_actions_report_id"),
        "moderation_actions",
        ["report_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_moderation_actions_target_user_id"),
        "moderation_actions",
        ["target_user_id"],
        unique=False,
    )


def downgrade() -> None:
    """Убирает журнал модерации и скрытие сообщений."""
    op.drop_index(
        op.f("ix_moderation_actions_target_user_id"),
        table_name="moderation_actions",
    )
    op.drop_index(
        op.f("ix_moderation_actions_report_id"), table_name="moderation_actions"
    )
    op.drop_index(
        op.f("ix_moderation_actions_moderator_id"), table_name="moderation_actions"
    )
    op.drop_index(
        op.f("ix_moderation_actions_created_at"), table_name="moderation_actions"
    )
    op.drop_index(op.f("ix_moderation_actions_action"), table_name="moderation_actions")
    op.drop_table("moderation_actions")

    op.drop_index(op.f("ix_messages_hidden_at"), table_name="messages")
    op.drop_column("messages", "hidden_reason")
    op.drop_column("messages", "hidden_at")
