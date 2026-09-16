"""Контакт пользователя — «записная книжка».

Отдельная таблица, потому что это ЛИЧНЫЕ данные владельца: он сам решает, кого
добавить и как называть (`custom_name` — псевдоним вроде «Мама» вместо
`@phone_ab12cd`). Собеседник об этом не узнаёт: псевдоним видит только владелец
(в списке чатов, шапке, карточке контакта и в уведомлениях).

Наличие строки НЕ влияет на переписку: удаление из контактов не удаляет чат.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from core.db_types import EncryptedText

from .base import Base


class Contact(Base):
    __tablename__ = "contacts"

    owner_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    contact_user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    # Псевдоним: пусто — показываем обычное имя/логин пользователя.
    # Шифруется «в покое»: имя вроде «Мама» выдаёт родственные связи, а по
    # колонке нет ни поиска, ни сортировки в SQL (сортировка — в Python,
    # api_v1/contacts/views.py).
    custom_name: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


__all__ = ("Contact",)
