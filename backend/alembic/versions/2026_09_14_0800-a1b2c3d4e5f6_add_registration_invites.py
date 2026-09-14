"""Персональные приглашения на регистрацию (`registration_invites`)

Закрытый доступ «по инвайтам»: публичная регистрация выключена
(REGISTRATION_ENABLED=false), а завести новый аккаунт можно только по
одноразовой ссылке, которую генерирует владелец сервиса (см.
scripts/create_invite.py) и передаёт лично приглашённому человеку.

Revision ID: a1b2c3d4e5f6
Revises: f0a1b2c3d4e5
Create Date: 2026-09-14 08:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "f0a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "registration_invites",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("phone_number", sa.String(length=20), nullable=True),
        sa.Column("note", sa.String(length=200), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_by_user_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["used_by_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_registration_invites_token",
        "registration_invites",
        ["token"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_registration_invites_token", table_name="registration_invites")
    op.drop_table("registration_invites")
