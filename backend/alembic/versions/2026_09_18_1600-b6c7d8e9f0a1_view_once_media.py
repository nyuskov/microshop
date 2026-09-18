"""Одноразовые медиа: вложение сгорает после просмотра

Revision ID: b6c7d8e9f0a1
Revises: a5b6c7d8e9f0
Create Date: 2026-09-18 16:00

Что это: у вложения появляется флаг «посмотреть один раз». Сервер отдаёт файл
ровно один раз (первый GET), после чего удаляет блоб и отвечает «истёк» — в
ленте остаётся только плашка «Просмотрено».

* ``messages.view_once`` — вложение одноразовое.
* ``messages.view_once_opened_at`` — когда его открыли (NULL — ещё нет). Нужен,
  чтобы отличить «истёк» от «ещё не открывали», и чтобы плашка в ленте знала,
  сгорело ли вложение (см. api_v1/messages/crud.py::message_to_dict).

Совместимость: новые столбцы с default/false, существующие данные не трогаются.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b6c7d8e9f0a1"
down_revision: Union[str, None] = "a5b6c7d8e9f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Добавляет флаг одноразового вложения и отметку об открытии."""
    op.add_column(
        "messages",
        sa.Column(
            "view_once",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
            comment="Вложение видно один раз (сгорает после просмотра)",
        ),
    )
    op.add_column(
        "messages",
        sa.Column(
            "view_once_opened_at",
            sa.DateTime(timezone=False),
            nullable=True,
            comment="Когда одноразовое вложение открыли (NULL — не открывали)",
        ),
    )


def downgrade() -> None:
    """Убирает одноразовость вложений."""
    op.drop_column("messages", "view_once_opened_at")
    op.drop_column("messages", "view_once")
