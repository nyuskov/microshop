"""Модель «замьюченный чат» (пользователь отключил уведомления о чате).

Наличие строки ``(user_id, chat_id)`` означает, что пользователь замьютил чат:
сервер не отправляет Web Push о новых сообщениях этого чата (см.
``api_v1/events/service.notify_chat``), а фронт не показывает всплывающие
уведомления в приложении (бейдж непрочитанных остаётся).
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ChatMute(Base):
    __tablename__ = "chat_mutes"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


__all__ = ("ChatMute",)
