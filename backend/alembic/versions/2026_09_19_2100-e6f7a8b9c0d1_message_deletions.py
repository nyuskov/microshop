"""«Удалить у меня»: скрытие сообщения для одного человека

Revision ID: e6f7a8b9c0d1
Revises: b3c4d5e6f7a8
Create Date: 2026-09-19 21:00

Сообщение можно убрать только у себя, оставив его остальным участникам: строка
``(message_id, user_id)`` в новой таблице означает «этому человеку не показывать».
Раньше удаление было одним — оно удаляло саму строку сообщения, то есть пропадало
у всех (и у собеседника тоже).

Почему отдельная таблица, а не флаг в ``messages``: у сообщения один автор, а
убрать его у себя может ЛЮБОЙ участник (в том числе чужое) — общий флаг на строку
для этого не годится.

``ON DELETE CASCADE`` на оба ключа: удалили сообщение (или аккаунт) — записи о
скрытии уходят вместе с ним, чистить их вручную не нужно.

Совместимость: только новая таблица, существующие данные не трогаются.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e6f7a8b9c0d1"
down_revision: Union[str, None] = "b3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Создаёт таблицу «сообщение скрыто у человека»."""
    op.create_table(
        "message_deletions",
        sa.Column(
            "message_id",
            sa.Integer(),
            nullable=False,
            comment="Сообщение, скрытое у этого человека",
        ),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("message_id", "user_id"),
    )
    # Выборки фильтруют по человеку («что скрыл я»), а не по сообщению, поэтому
    # индекс нужен именно на user_id: первичный ключ начинается с message_id.
    op.create_index("ix_message_deletions_user_id", "message_deletions", ["user_id"])


def downgrade() -> None:
    """Убирает скрытия: «удалённые у меня» сообщения снова станут видны."""
    op.drop_index("ix_message_deletions_user_id", table_name="message_deletions")
    op.drop_table("message_deletions")
