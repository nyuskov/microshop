"""Обёртки ключа чата на каждое устройство (``chat_device_keys``, E2EE)

Revision ID: f1a2b3c4d5e6
Revises: c4d5e6f7a8b9
Create Date: 2026-09-17 21:00

Зачем: `device_keys` уже хранит по ключу на каждое устройство, но личный чат
шифровался ключом, выведенным из общего секрета ДВУХ «текущих» ключей аккаунтов.
У человека с телефоном и ноутбуком «текущий» ключ один, поэтому второе устройство
новые сообщения прочитать не могло.

Теперь ключ личного чата может быть симметричным (как в группах,
``chat_group_keys``): он живёт только у клиентов, а сервер хранит обёртки —
ключ чата, зашифрованный на общем секрете ECDH между устройством-раздатчиком и
устройством-получателем. Строка — на пару ``(chat_id, user_id, device_id)``,
плюс ``wrapped_by_user_id``/``wrapped_by_device_id``: получателю нужно знать,
с чьим публичным ключом повторять ECDH.

Совместимость: таблица только добавляется, старые парные ключи никуда не
деваются. Клиент включает режим обёрток, когда у участников появляется больше
одного устройства (см. `frontend/src/services/e2ee.ts`) — до этого чат читается
по-прежнему парным ключом.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "c4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Создаёт таблицу обёрток ключа чата по устройствам."""
    op.create_table(
        "chat_device_keys",
        sa.Column("chat_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "device_id",
            sa.String(length=64),
            nullable=False,
            comment="Устройство-получатель обёртки (legacy — старое устройство)",
        ),
        sa.Column(
            "wrapped_key",
            sa.Text(),
            nullable=False,
            comment="Ключ чата, зашифрованный для этого устройства",
        ),
        sa.Column("wrapped_by_user_id", sa.Integer(), nullable=True),
        sa.Column("wrapped_by_device_id", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["wrapped_by_user_id"], ["user.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("chat_id", "user_id", "device_id"),
    )
    # Ротация ключа переписывает обёртки всего чата — выборка идёт по chat_id.
    op.create_index(
        "ix_chat_device_keys_chat_id", "chat_device_keys", ["chat_id"], unique=False
    )


def downgrade() -> None:
    """Убирает таблицу: чаты возвращаются к парным ключам."""
    op.drop_index("ix_chat_device_keys_chat_id", table_name="chat_device_keys")
    op.drop_table("chat_device_keys")
