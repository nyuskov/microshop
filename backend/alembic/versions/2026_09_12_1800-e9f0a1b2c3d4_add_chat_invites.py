"""Ссылки-приглашения в группы (`chat_invites`)

Ссылка даёт вход в группу без ручного добавления: создатель или админ делает её
в карточке группы и отправляет другу. Ссылку можно ограничить по сроку и числу
входов и отозвать в любой момент.

Revision ID: e9f0a1b2c3d4
Revises: d8e9f0a1b2c3
Create Date: 2026-09-12 18:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e9f0a1b2c3d4"
down_revision: Union[str, None] = "d8e9f0a1b2c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "chat_invites",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("chat_id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("uses", sa.Integer(), server_default="0", nullable=False),
        sa.Column("revoked", sa.Boolean(), server_default="false", nullable=False),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_invites_chat_id", "chat_invites", ["chat_id"])
    op.create_index("ix_chat_invites_token", "chat_invites", ["token"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_chat_invites_token", table_name="chat_invites")
    op.drop_index("ix_chat_invites_chat_id", table_name="chat_invites")
    op.drop_table("chat_invites")
