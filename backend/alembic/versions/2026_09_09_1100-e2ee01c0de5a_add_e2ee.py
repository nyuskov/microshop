"""Add device_keys table and messages.encrypted

Этап 1 сквозного шифрования (E2EE):
- таблица device_keys — один «текущий» публичный ключ устройства на
  пользователя (upsert по user_id);
- флаг messages.encrypted — текст сообщения является шифротекстом.

Revision ID: e2ee01c0de5a
Revises: c6d7e8f9a0b1
Create Date: 2026-09-09 11:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e2ee01c0de5a"
down_revision: Union[str, Sequence[str], None] = "c6d7e8f9a0b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "device_keys",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("public_key", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_device_keys_user_id", "device_keys", ["user_id"], unique=True)
    op.add_column(
        "messages",
        sa.Column(
            "encrypted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("messages", "encrypted")
    op.drop_index("ix_device_keys_user_id", table_name="device_keys")
    op.drop_table("device_keys")
