"""Мягкая блокировка: «только звонки» (`user_blocks.messages_allowed`)

Блокировка была одна на все случаи: сообщения запрещены, звонки запрещены, чат
скрыт. На практике часто нужно другое — «не звони мне, но писать можно»
(навязчивые звонки от знакомого, но переписка нужна). Тогда полная блокировка
слишком грубая: человек теряет и переписку.

Теперь у блокировки есть вид:
* ``messages_allowed = false`` (значение по умолчанию) — прежнее поведение;
* ``messages_allowed = true`` — сообщения проходят, чат на месте, но звонок
  не проходит (в обе стороны, как и у полной блокировки).

Default у колонки — false: у существующих строк получается ровно то поведение,
что было до миграции.

Revision ID: f5a6b7c8d9e0
Revises: c9d0e1f2a3b4
Create Date: 2026-09-16 14:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f5a6b7c8d9e0"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_blocks",
        sa.Column(
            "messages_allowed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("user_blocks", "messages_allowed")
