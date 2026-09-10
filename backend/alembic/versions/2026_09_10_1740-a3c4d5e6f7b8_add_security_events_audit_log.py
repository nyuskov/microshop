"""security events audit log

Новая таблица ``security_events`` — журнал безопасности аккаунта: входы (успешные
и неудачные), запрос кодов, подтверждение нового устройства, смена/сброс пароля,
смена e-mail, отзыв сессий, удаление аккаунта. Нужен, чтобы ответить на вопрос
«что происходило с аккаунтом» (см. ``api_v1/auth/audit.py``).

``user_id`` — ON DELETE SET NULL: сам факт события остаётся и после удаления
аккаунта (для разбора инцидентов), а старые записи подчищает еженедельная задача
``tasks.security_tasks.prune_security_events``.

Revision ID: a3c4d5e6f7b8
Revises: f2b3c4d5e6a7
Create Date: 2026-09-10 17:40:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3c4d5e6f7b8"
down_revision: Union[str, Sequence[str], None] = "f2b3c4d5e6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Создаёт журнал безопасности аккаунта."""
    op.create_table(
        "security_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("event", sa.String(length=40), nullable=False),
        sa.Column("ip", sa.String(length=64), nullable=False, server_default=""),
        sa.Column(
            "device_signature",
            sa.String(length=64),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "device_user_agent",
            sa.String(length=255),
            nullable=False,
            server_default="",
        ),
        sa.Column("detail", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_security_events_user_id"), "security_events", ["user_id"], unique=False
    )
    op.create_index(
        op.f("ix_security_events_event"), "security_events", ["event"], unique=False
    )
    op.create_index(
        op.f("ix_security_events_created_at"),
        "security_events",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    """Удаляет журнал безопасности."""
    op.drop_index(op.f("ix_security_events_created_at"), table_name="security_events")
    op.drop_index(op.f("ix_security_events_event"), table_name="security_events")
    op.drop_index(op.f("ix_security_events_user_id"), table_name="security_events")
    op.drop_table("security_events")
