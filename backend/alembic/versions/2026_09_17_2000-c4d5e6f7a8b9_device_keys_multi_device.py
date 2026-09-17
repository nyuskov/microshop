"""Ключ устройства: несколько устройств на аккаунт (``device_keys.device_id``)

Revision ID: c4d5e6f7a8b9
Revises: f9a0b1c2d3e4
Create Date: 2026-09-17 20:00

Зачем: у каждого пользователя хранился ОДИН публичный ключ E2EE (уникальный
``user_id``). Второй вход — с телефона, из другого браузера, после чистки данных
сайта — заменял его, и вся прежняя переписка на первом устройстве становилась
нечитаемой. Это самая частая жалоба на такие схемы.

Теперь ключей у человека столько, сколько у него устройств: строка идентифицируется
парой ``(user_id, device_id)``, где ``device_id`` — идентификатор, который клиент
генерирует и хранит у себя (в localStorage). Никаких «сессий» в БД для этого не
нужно: устройство — это просто ещё один публичный ключ.

Существующие строки получают ``device_id='legacy'``: они и есть ключ «того самого»
устройства, которым человек пользуется сейчас. Так совместимость сохраняется —
старый клиент, который не присылает ``device_id``, продолжает писать в ``legacy``.

Что это открывает (следующий шаг, уже на клиенте): сообщение шифруется ключом
чата, а ключ передаётся «обёртками» на КАЖДОЕ устройство получателя — тогда
переписку читают все свои устройства, а не только последнее вошедшее.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4d5e6f7a8b9"
down_revision: Union[str, None] = "f9a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Разрешает несколько ключей на пользователя (по одному на устройство)."""
    op.add_column(
        "device_keys",
        sa.Column(
            "device_id",
            sa.String(length=64),
            nullable=False,
            server_default="legacy",
            comment="Идентификатор устройства (генерирует клиент и хранит у себя)",
        ),
    )
    # Прежняя уникальность «одна строка на пользователя» больше не нужна: у
    # человека может быть телефон, ноутбук и второй браузер.
    op.drop_index("ix_device_keys_user_id", table_name="device_keys")
    op.create_index("ix_device_keys_user_id", "device_keys", ["user_id"])
    op.create_unique_constraint(
        "uq_device_keys_user_device", "device_keys", ["user_id", "device_id"]
    )


def downgrade() -> None:
    """Оставляет по одному ключу на пользователя (самый свежий)."""
    # Лишние устройства придётся удалить: вернуть уникальность иначе нельзя.
    op.execute(
        """
        DELETE FROM device_keys d
        USING device_keys newer
        WHERE d.user_id = newer.user_id
          AND (newer.updated_at, newer.id) > (d.updated_at, d.id)
        """
    )
    op.drop_constraint("uq_device_keys_user_device", "device_keys", type_="unique")
    op.drop_index("ix_device_keys_user_id", table_name="device_keys")
    op.create_index("ix_device_keys_user_id", "device_keys", ["user_id"], unique=True)
    op.drop_column("device_keys", "device_id")
