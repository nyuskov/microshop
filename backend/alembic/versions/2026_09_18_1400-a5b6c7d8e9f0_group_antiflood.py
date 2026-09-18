"""Анти-флуд в группах: мут участника, бан-лист и медленный режим

Revision ID: a5b6c7d8e9f0
Revises: c1d2e3f4a5b9
Create Date: 2026-09-18 14:00

Три части одной задачи — «остановить флуд в группе»:

* ``chat_user_association.muted_until`` — до какого времени участник молчит.
  Мут живёт в самом членстве, а не в отдельной таблице: он неразрывно связан с
  участием (исключили — мут не нужен), а срок снимается сам по времени.
* ``chat_bans`` — кого в группу больше не пускать. Исключение эту задачу не
  решает: исключённый возвращается по той же ссылке-приглашению.
* ``chats.slow_mode_seconds`` — сколько секунд участник ждёт между сообщениями
  (0 — выключено). Админов режим не ограничивает.

Совместимость: новые столбцы nullable/default, существующие данные не трогаются.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a5b6c7d8e9f0"
down_revision: Union[str, None] = "c1d2e3f4a5b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Добавляет мут участника, бан-лист и медленный режим."""
    op.add_column(
        "chat_user_association",
        sa.Column(
            "muted_until",
            sa.DateTime(timezone=False),
            nullable=True,
            comment="До какого времени участник не может писать (NULL — не в муте)",
        ),
    )
    op.add_column(
        "chats",
        sa.Column(
            "slow_mode_seconds",
            sa.Integer(),
            server_default="0",
            nullable=False,
            comment="Пауза между сообщениями участника, секунды (0 — выключено)",
        ),
    )
    op.create_table(
        "chat_bans",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("chat_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("banned_by_id", sa.Integer(), nullable=True),
        sa.Column(
            "reason",
            sa.String(length=200),
            nullable=True,
            comment="Причина бана (видна админам)",
        ),
        sa.Column(
            "banned_at",
            sa.DateTime(timezone=False),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["banned_by_id"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("chat_id", "user_id", name="uq_chat_bans_chat_user"),
    )
    op.create_index("ix_chat_bans_chat_id", "chat_bans", ["chat_id"])
    op.create_index("ix_chat_bans_user_id", "chat_bans", ["user_id"])


def downgrade() -> None:
    """Убирает бан-лист, мут и медленный режим."""
    op.drop_index("ix_chat_bans_user_id", table_name="chat_bans")
    op.drop_index("ix_chat_bans_chat_id", table_name="chat_bans")
    op.drop_table("chat_bans")
    op.drop_column("chats", "slow_mode_seconds")
    op.drop_column("chat_user_association", "muted_until")
