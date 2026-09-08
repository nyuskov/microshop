"""Add telegram binding (tg_chat_id + telegram_bind_links)

Доставка OTP через Telegram: основной канал — Telegram Gateway; резервный —
обычный бот, для чего пользователь «привязывает» свой Telegram-чат к аккаунту.

Revision ID: a7b8c9d0e1f2
Revises: f0e1d2c3b4a5
Create Date: 2026-09-08 10:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, Sequence[str], None] = "f0e1d2c3b4a5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ID чата пользователя с нашим ботом (привязка для fallback-доставки кода).
    op.add_column(
        "user",
        sa.Column("tg_chat_id", sa.BigInteger(), nullable=True),
    )
    op.create_index("ix_user_tg_chat_id", "user", ["tg_chat_id"], unique=True)

    # Одноразовые коды привязки: короткий код -> user_id (+ срок жизни).
    op.create_table(
        "telegram_bind_links",
        sa.Column("code", sa.String(length=40), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_telegram_bind_links_user_id",
        "telegram_bind_links",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_table("telegram_bind_links")
    op.drop_index("ix_user_tg_chat_id", table_name="user")
    op.drop_column("user", "tg_chat_id")
