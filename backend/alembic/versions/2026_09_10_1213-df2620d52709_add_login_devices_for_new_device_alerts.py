"""add login devices for new-device alerts

Создаёт таблицу известных устройств входа: по ней определяем «вход с нового
устройства» и уведомляем владельца письмом (см. api_v1/auth/security_notifications).

Revision ID: df2620d52709
Revises: e3f4a5b6c7d8
Create Date: 2026-09-10 12:13:16.274581

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "df2620d52709"
down_revision: Union[str, Sequence[str], None] = "e3f4a5b6c7d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Создаёт login_devices (отпечаток браузера/приложения на пользователя)."""
    op.create_table(
        "login_devices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("signature", sa.String(length=64), nullable=False),
        sa.Column("user_agent", sa.String(length=255), nullable=False),
        sa.Column("last_ip", sa.String(length=64), nullable=False),
        sa.Column(
            "first_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "signature", name="uq_login_device_user_signature"
        ),
    )
    op.create_index(
        op.f("ix_login_devices_user_id"),
        "login_devices",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    """Удаляет login_devices."""
    op.drop_index(op.f("ix_login_devices_user_id"), table_name="login_devices")
    op.drop_table("login_devices")
