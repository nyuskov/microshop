"""Администратор и владелец — разные роли: ``user.is_admin``

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-09-17 16:00

Зачем: до этого была одна роль — ``is_superuser`` («суперадмин»), и она давала
сразу всё: разбор жалоб, приглашения, обход экрана техработ И рубильник
техработ. Владельцу сервиса нужно было выдать помощникам админские права, не
отдавая при этом рубильник (включить техработы — это остановка сервиса).

Теперь:

* ``is_admin`` — администратор: жалобы, приглашения, обход экрана техработ;
* ``is_superuser`` — владелец: всё то же плюс переключение техработ.

Обратная совместимость: у всех, кто был ``is_superuser``, сохраняется полный
доступ (они и так владельцы). Существующие администраторы — владелец и те, кому
роль выдавали вручную; для них ничего не меняется, новые права не выдаются
(``is_admin`` по умолчанию ``FALSE``).
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e8f9a0b1c2d3"
down_revision: Union[str, None] = "d7e8f9a0b1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Добавляет признак администратора (жалобы, приглашения, обход техработ)."""
    op.add_column(
        "user",
        sa.Column(
            "is_admin",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
            comment="Администратор: модерация и приглашения, без рубильника техработ",
        ),
    )


def downgrade() -> None:
    """Убирает признак администратора."""
    op.drop_column("user", "is_admin")
