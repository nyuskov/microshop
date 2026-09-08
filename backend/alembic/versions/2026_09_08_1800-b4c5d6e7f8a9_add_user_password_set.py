"""Add user.password_set flag

Пометка о том, что пользователь задал собственный пароль (вход по телефону +
пароль). У аккаунтов, созданных через OTP/SMS, пароль случайный и флаг = False —
при входе им предлагается придумать свой пароль.

Revision ID: b4c5d6e7f8a9
Revises: a7b8c9d0e1f2
Create Date: 2026-09-08 18:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b4c5d6e7f8a9"
down_revision: Union[str, Sequence[str], None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Существующие аккаунты (созданные через OTP) получают False — у них
    # случайный пароль, который пользователь не знает.
    op.add_column(
        "user",
        sa.Column(
            "password_set",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("user", "password_set")
