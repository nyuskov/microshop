"""Add otp_codes table

Revision ID: a1f2e3d4b5c6
Revises: d5e6f7a8b9c0
Create Date: 2026-09-07 15:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1f2e3d4b5c6"
down_revision: Union[str, Sequence[str], None] = "d5e6f7a8b9c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # OTP-коды в БД вместо in-memory хранилища: код хранится хешем, счётчик
    # неудачных попыток защищает от перебора, created_at — для кулдауна рассылки.
    op.create_table(
        "otp_codes",
        sa.Column("phone_number", sa.String(length=20), primary_key=True),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "attempts",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("otp_codes")
