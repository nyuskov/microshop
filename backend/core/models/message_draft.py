"""Модель «черновик сообщения» (недописанный текст в чате).

Черновик хранится на сервере, а не только в браузере: так он переживает
переустановку приложения и доступен с другого устройства.

Содержимое — ровно то, что уходит в сообщение: в чате со сквозным шифрованием
это шифротекст (``e2ee1:…``), и сервер его не читает. Сервер лишь хранит строку
и отдаёт её владельцу.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from core.db_types import EncryptedText

from .base import Base


class MessageDraft(Base):
    __tablename__ = "message_drafts"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), primary_key=True
    )
    text: Mapped[str] = mapped_column(EncryptedText)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


__all__ = ("MessageDraft",)
