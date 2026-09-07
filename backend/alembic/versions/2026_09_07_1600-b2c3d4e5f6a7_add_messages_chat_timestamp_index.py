"""Add messages chat_id+timestamp index

Revision ID: b2c3d4e5f6a7
Revises: a1f2e3d4b5c6
Create Date: 2026-09-07 16:00:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, Sequence[str], None] = "a1f2e3d4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # История чата и «последние сообщения» выбираются по (chat_id, timestamp).
    op.create_index(
        "ix_messages_chat_timestamp",
        "messages",
        ["chat_id", "timestamp"],
    )


def downgrade() -> None:
    op.drop_index("ix_messages_chat_timestamp", table_name="messages")
