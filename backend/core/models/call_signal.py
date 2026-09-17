"""Модели хранилища сигналинга звонков (см. `api_v1/calls/store.py`).

Парковка вызова и недоставленные сигнальные сообщения лежали в памяти процесса
web. Это работало, пока процесс один: при двух (деплой «синий/зелёный»,
масштабирование) припаркованный вызов и придержанный ответ терялись — абонент,
открывший приложение на другом слоте, звонить себе не слышал.

Обе таблицы — технические: строки живут минуты (``expires_at``) и удаляются при
чтении и ленивой чистке, поэтому в дампах они почти всегда пусты.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from .mixins import IdIntPkMixin


class PendingCallOffer(Base):
    """Припаркованный входящий вызов: один на абонента."""

    __tablename__ = "pending_call_offers"

    #: Абонент — он же первичный ключ: второй одновременный вызов вытесняет первый.
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    #: Номер вызова (`call-…`), чтобы снять парковку именно этого вызова.
    call_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Готовый offer сигналинга (пересылается абоненту как есть).
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    #: Когда парковка перестаёт быть нужной (naive UTC, как `messages.timestamp`).
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), index=True)


class QueuedCallSignal(IdIntPkMixin, Base):
    """Недоставленное сигнальное сообщение (ответ, ICE-кандидаты, завершение)."""

    __tablename__ = "queued_call_signals"
    __table_args__ = (
        # Читаем и чистим всегда по пользователю, отсортировав по порядку
        # добавления (id): порядок сигналинга важен, offer должен идти раньше ICE.
        Index("ix_queued_call_signals_user_id", "user_id", "id"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), index=True
    )


__all__ = ("PendingCallOffer", "QueuedCallSignal")
