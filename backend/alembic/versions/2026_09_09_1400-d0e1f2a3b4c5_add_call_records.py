"""Add messages call-record fields (системные отметки о звонках в чате)

Для kind='call' (текст пустой) хранятся: тип звонка (audio/video), исход
(completed/missed/declined), длительность (сек) и инициатор.

Revision ID: d0e1f2a3b4c5
Revises: c8d9e0f1a2b3
Create Date: 2026-09-09 14:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, Sequence[str], None] = "c8d9e0f1a2b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("kind", sa.String(length=10), nullable=False, server_default="text"),
    )
    op.add_column(
        "messages",
        sa.Column("call_kind", sa.String(length=10), nullable=True),
    )
    op.add_column(
        "messages",
        sa.Column("call_state", sa.String(length=12), nullable=True),
    )
    op.add_column(
        "messages",
        sa.Column("call_duration", sa.Integer(), nullable=True),
    )
    op.add_column(
        "messages",
        sa.Column("call_caller_id", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("messages", "call_caller_id")
    op.drop_column("messages", "call_duration")
    op.drop_column("messages", "call_state")
    op.drop_column("messages", "call_kind")
    op.drop_column("messages", "kind")
