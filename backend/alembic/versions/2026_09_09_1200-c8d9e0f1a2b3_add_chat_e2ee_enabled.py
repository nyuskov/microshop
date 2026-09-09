"""Add chats.e2ee_enabled (тип чата: обычный / зашифрованный)

Тип чата:
- False (по умолчанию) — «обычный»: сервер хранит текст как есть, текст виден
  в превью списка чатов и в push-уведомлениях;
- True — «зашифрованный» (E2EE): клиенты обмениваются шифротекстом, сервер его
  не читает.

Revision ID: c8d9e0f1a2b3
Revises: e2ee01c0de5a
Create Date: 2026-09-09 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8d9e0f1a2b3"
down_revision: Union[str, Sequence[str], None] = "e2ee01c0de5a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "chats",
        sa.Column(
            "e2ee_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("chats", "e2ee_enabled")
