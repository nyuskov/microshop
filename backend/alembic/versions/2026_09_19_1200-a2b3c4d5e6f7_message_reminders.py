"""Напоминания о сообщении («напомнить мне»)

Revision ID: a2b3c4d5e6f7
Revises: c8d9e0f1a2b4
Create Date: 2026-09-19 12:00

Человек просит вернуть его к уже отправленному сообщению: «напомни вечером».
Очередь разбирает Celery beat раз в минуту (``tasks/scheduled_tasks.py``), а
доставляет push — иначе напоминание приходило бы только с открытым приложением.

Текста сообщения здесь нет: напоминание ссылается на сообщение, а текст берётся
из него в момент срабатывания (его могли отредактировать или удалить).

Совместимость: только новая таблица, существующие данные не трогаются.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a2b3c4d5e6f7"
down_revision: Union[str, None] = "c8d9e0f1a2b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Создаёт таблицу напоминаний о сообщениях."""
    op.create_table(
        "message_reminders",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("chat_id", sa.Integer(), nullable=False),
        sa.Column(
            "message_id",
            sa.Integer(),
            nullable=False,
            comment="Сообщение, о котором напоминаем",
        ),
        sa.Column(
            "remind_at",
            sa.DateTime(timezone=False),
            nullable=False,
            comment="Когда напомнить (UTC)",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=False),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "message_id", name="uq_message_reminders_user_message"
        ),
    )
    op.create_index(
        "ix_message_reminders_remind_at", "message_reminders", ["remind_at"]
    )
    op.create_index(
        "ix_message_reminders_user_chat",
        "message_reminders",
        ["user_id", "chat_id"],
    )


def downgrade() -> None:
    """Убирает напоминания (не сработавшие пропадут)."""
    op.drop_index("ix_message_reminders_user_chat", table_name="message_reminders")
    op.drop_index("ix_message_reminders_remind_at", table_name="message_reminders")
    op.drop_table("message_reminders")
