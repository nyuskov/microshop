"""Тихие часы: окно «не беспокоить» в профиле пользователя

Человек умеет отключать уведомления целиком (``notifications_enabled``) или по
конкретному чату (``chat_mutes``), но «глубокой ночью не будить» настраиваемого
не было. Здесь — настройка получателя: включён ли режим, границы окна и разрешены
ли звонки.

Время храним в МИНУТАХ от полуночи (0…1439) — не строкой «23:30»: так границы
сравниваются числами, без разбора формата, и клиенту нечего испортить.
``quiet_hours_offset`` — сдвиг местного времени от UTC в минутах; его присылает
клиент при сохранении настроек (у устройства он всегда актуален, серверу не
нужна база часовых поясов).

Значения по умолчанию (окно 23:00–08:00, звонки разрешены) ставятся
server_default: у уже существующих профилей значения обязаны появиться, иначе
колонки NOT NULL не добавить.

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-09-16 10:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "profile",
        sa.Column(
            "quiet_hours_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "profile",
        sa.Column(
            "quiet_hours_start",
            sa.Integer(),
            nullable=False,
            server_default="1380",
        ),
    )
    op.add_column(
        "profile",
        sa.Column(
            "quiet_hours_end",
            sa.Integer(),
            nullable=False,
            server_default="480",
        ),
    )
    op.add_column(
        "profile",
        sa.Column(
            "quiet_hours_allow_calls",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.add_column(
        "profile",
        sa.Column(
            "quiet_hours_offset",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("profile", "quiet_hours_offset")
    op.drop_column("profile", "quiet_hours_allow_calls")
    op.drop_column("profile", "quiet_hours_end")
    op.drop_column("profile", "quiet_hours_start")
    op.drop_column("profile", "quiet_hours_enabled")
