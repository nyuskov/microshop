"""Служебные настройки сервиса (`app_settings`)

Первый рубильник, который не хочется держать в `.env`, — режим технических
работ: его нужно включать и выключать на живом сервере, без правки файла и
перезапуска контейнеров (см. `core/maintenance.py`, `api_v1/system/views.py`).

Таблица простая: ключ → значение JSON. Шифровать «в покое» значение не нужно —
текст сообщения о техработах видёт каждый посетитель, это не личные данные
(для личного текста есть `EncryptedText`).

Revision ID: c5d6e7f8a9b0
Revises: b7c8d9e0f1a2
Create Date: 2026-09-17 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5d6e7f8a9b0"
down_revision: Union[str, None] = "b7c8d9e0f1a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"], ["user.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
