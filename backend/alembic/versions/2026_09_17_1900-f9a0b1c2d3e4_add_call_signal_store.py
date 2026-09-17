"""Парковка вызова и очередь сигналинга — в БД, а не в памяти процесса web

Revision ID: f9a0b1c2d3e4
Revises: e8f9a0b1c2d3
Create Date: 2026-09-17 19:00

Зачем: сигналинг звонков уже доставляется между процессами web через мост
RabbitMQ, но СОСТОЯНИЕ (припаркованный офлайн-вызов и недоставленные сигнальные
сообщения) оставалось в памяти процесса. При двух процессах (деплой
«синий/зелёный», масштабирование) это давало две поломки:

* абонент открывал приложение на другом слоте и не получал припаркованный вызов:
  парковка лежала в процессе, где звонили;
* придержанный ответ/завершение тоже не доходили — у зовущего звонок «звонил»
  до собственного таймаута.

Таблицы технические и почти всегда пустые: строки живут минуты (`expires_at`) и
удаляются при чтении и ленивой чистке.

* ``pending_call_offers`` — один припаркованный вызов на абонента (первичный ключ
  по `user_id`: новый вызов вытесняет старый);
* ``queued_call_signals`` — недоставленные сигнальные сообщения, порядок
  сохраняем по `id` (offer должен прийти раньше ICE-кандидатов).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f9a0b1c2d3e4"
down_revision: Union[str, None] = "e8f9a0b1c2d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Создаёт таблицы парковки вызова и очереди сигналинга."""
    op.create_table(
        "pending_call_offers",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            primary_key=True,
            comment="Абонент: второй одновременный вызов вытесняет первый",
        ),
        sa.Column(
            "call_id",
            sa.Text(),
            nullable=True,
            comment="Номер вызова, чтобы снять парковку именно этого вызова",
        ),
        sa.Column(
            "payload",
            postgresql.JSONB(),
            nullable=False,
            comment="Готовый offer сигналинга (пересылается абоненту как есть)",
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=False),
            nullable=False,
            comment="Когда парковка перестаёт быть нужной (naive UTC)",
        ),
    )
    op.create_index(
        "ix_pending_call_offers_expires_at", "pending_call_offers", ["expires_at"]
    )

    op.create_table(
        "queued_call_signals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "payload",
            postgresql.JSONB(),
            nullable=False,
            comment="Сигнальное сообщение (ответ, ICE-кандидаты, завершение)",
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=False),
            nullable=False,
            server_default=sa.func.now(),
            comment="Срок жизни сообщения (naive UTC)",
        ),
    )
    op.create_index(
        "ix_queued_call_signals_user_id", "queued_call_signals", ["user_id", "id"]
    )
    op.create_index(
        "ix_queued_call_signals_expires_at", "queued_call_signals", ["expires_at"]
    )


def downgrade() -> None:
    """Удаляет таблицы парковки и очереди сигналинга."""
    op.drop_index("ix_queued_call_signals_expires_at", table_name="queued_call_signals")
    op.drop_index("ix_queued_call_signals_user_id", table_name="queued_call_signals")
    op.drop_table("queued_call_signals")
    op.drop_index("ix_pending_call_offers_expires_at", table_name="pending_call_offers")
    op.drop_table("pending_call_offers")
