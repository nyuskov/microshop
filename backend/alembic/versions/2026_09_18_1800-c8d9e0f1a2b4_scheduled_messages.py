"""Отложенные сообщения: «отправить позже»

Revision ID: c8d9e0f1a2b4
Revises: b6c7d8e9f0a1
Create Date: 2026-09-18 18:00

Пользователь пишет текст и назначает время: «не пишу ночью — отправлю в 9:00».
Разбирает очередь Celery beat раз в минуту (``tasks/scheduled_tasks.py``), то
есть сообщение уйдёт и с закрытым приложением.

Хранится только текст: вложение пришлось бы держать на диске до срока, а при
отмене отправки файл остался бы «сиротой».

Совместимость: только новая таблица, существующие данные не трогаются.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8d9e0f1a2b4"
down_revision: Union[str, None] = "b6c7d8e9f0a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Создаёт таблицу отложенных сообщений."""
    op.create_table(
        "scheduled_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("chat_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False, comment="Текст сообщения"),
        sa.Column(
            "encrypted",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
            comment="Чат зашифрован (E2EE): в тексте шифротекст клиента",
        ),
        sa.Column(
            "reply_to_id",
            sa.Integer(),
            nullable=True,
            comment="id сообщения, на которое отвечаем при отправке",
        ),
        sa.Column(
            "send_at",
            sa.DateTime(timezone=False),
            nullable=False,
            comment="Когда отправить (UTC)",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=False),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scheduled_messages_send_at", "scheduled_messages", ["send_at"])
    op.create_index(
        "ix_scheduled_messages_chat_user",
        "scheduled_messages",
        ["chat_id", "user_id"],
    )


def downgrade() -> None:
    """Убирает отложенные сообщения (неотправленные пропадут)."""
    op.drop_index("ix_scheduled_messages_chat_user", table_name="scheduled_messages")
    op.drop_index("ix_scheduled_messages_send_at", table_name="scheduled_messages")
    op.drop_table("scheduled_messages")
