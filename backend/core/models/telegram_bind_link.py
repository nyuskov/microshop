"""Модель одноразовых кодов привязки Telegram-чата к аккаунту.

Поток привязки (обычный Telegram-бот, резервный канал доставки OTP):

1. Пользователь (уже вошёл по телефону) жмёт «Привязать Telegram»;
2. бэкенд создаёт ``TelegramBindLink`` (короткий код -> user_id, со сроком);
3. пользователь открывает ``t.me/<bot>?start=bind_<код>`` и жмёт Start;
4. воркер (``tasks/telegram.telegram_poll_updates``) ловит ``/start bind_<код>``,
   ставит ``user.tg_chat_id`` и удаляет использованную ссылку.

Код короткий, т.к. payload ``start`` ограничен 64 символами.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class TelegramBindLink(Base):
    """Одноразовая ссылка привязки Telegram (код — первичный ключ)."""

    __tablename__ = "telegram_bind_links"

    code: Mapped[str] = mapped_column(String(40), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
