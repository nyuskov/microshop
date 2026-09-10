"""email_verified + email_codes: подтверждение адреса и вход по e-mail

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-09-10 20:00

1) ``user.email_verified`` — адрес подтверждён кодом из письма; только такой
   адрес можно использовать для входа без пароля и восстановления доступа.
2) ``email_codes`` — хеши кодов, отправленных на адрес (подтверждение/вход/сброс).
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e3f4a5b6c7d8"
down_revision: Union[str, None] = "d2e3f4a5b6c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column(
            "email_verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_table(
        "email_codes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_codes_email", "email_codes", ["email"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_email_codes_email", table_name="email_codes")
    op.drop_table("email_codes")
    op.drop_column("user", "email_verified")
