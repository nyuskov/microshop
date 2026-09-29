"""Приватность присутствия: не показывать другим «в сети»/«был(а) …»

Revision ID: d1e2f3a4b5c6
Revises: a8b9c0d1e2f3
Create Date: 2026-09-29 15:00

Присутствие (колонка ``user.last_seen`` и события WS ``presence``) раньше уходило
всем, с кем есть общий чат. Человек просил это скрыть: по времени последней
активности видно режим дня, а это личное.

Флаг живёт на ``user``, а не на профиле: присутствие — свойство аккаунта (как
``status`` и ``last_seen``), и профиль тут ни при чём (у части аккаунтов его
вовсе нет). Настройка односторонняя (как в WhatsApp): своё присутствие человек
скрывает, а чужое видит как раньше; поэтому в запросах не нужен контекст
зрителя — достаточно флага того, о ком отдаём данные.

Совместимость: колонка NOT NULL с server_default false — у всех существующих
аккаунтов присутствие остаётся видимым, поведение не меняется.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, None] = "a8b9c0d1e2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Добавляет флаг «скрывать своё присутствие»."""
    op.add_column(
        "user",
        sa.Column(
            "presence_hidden",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
            comment="Не показывать другим «в сети»/«был(а) …»",
        ),
    )


def downgrade() -> None:
    """Убирает флаг: присутствие снова видно всем."""
    op.drop_column("user", "presence_hidden")
