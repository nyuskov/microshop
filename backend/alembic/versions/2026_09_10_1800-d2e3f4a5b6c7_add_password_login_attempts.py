"""password_login_attempts + user.password_weak: защита входа

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-09-10 18:00

1) Считаем неудачные попытки входа по одному идентификатору (номер/логин) и
   временно блокируем его — лимиты «по IP» обходятся сменой адреса.
2) Флаг ``user.password_weak`` — пароль не проходит политику (ставится при входе,
   когда пароль известен в открытом виде).
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d2e3f4a5b6c7"
down_revision: Union[str, None] = "c1d2e3f4a5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "password_login_attempts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("identifier", sa.String(length=128), nullable=False),
        sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_password_login_attempts_identifier",
        "password_login_attempts",
        ["identifier"],
        unique=True,
    )
    op.add_column(
        "user",
        sa.Column(
            "password_weak",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("user", "password_weak")
    op.drop_index(
        "ix_password_login_attempts_identifier", table_name="password_login_attempts"
    )
    op.drop_table("password_login_attempts")
