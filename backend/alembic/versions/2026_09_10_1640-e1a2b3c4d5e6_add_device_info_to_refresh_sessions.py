"""add device info to refresh sessions

В refresh_sessions появляются сведения об устройстве входа (подпись sha256 от
User-Agent, сам User-Agent и IP). По ним собирается список активных входов в
профиле («Безопасность») и определяется «текущий» вход; у существующих записей
значения пустые — они просто не показывают устройство.

Revision ID: e1a2b3c4d5e6
Revises: df2620d52709
Create Date: 2026-09-10 16:40:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "df2620d52709"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Добавляет колонки устройства в refresh_sessions (со значениями по умолчанию)."""
    op.add_column(
        "refresh_sessions",
        sa.Column(
            "device_signature",
            sa.String(length=64),
            nullable=False,
            server_default="",
        ),
    )
    op.add_column(
        "refresh_sessions",
        sa.Column(
            "device_user_agent",
            sa.String(length=255),
            nullable=False,
            server_default="",
        ),
    )
    op.add_column(
        "refresh_sessions",
        sa.Column("device_ip", sa.String(length=64), nullable=False, server_default=""),
    )


def downgrade() -> None:
    """Убирает колонки устройства."""
    op.drop_column("refresh_sessions", "device_ip")
    op.drop_column("refresh_sessions", "device_user_agent")
    op.drop_column("refresh_sessions", "device_signature")
