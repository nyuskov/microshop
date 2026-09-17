"""Служебные настройки сервиса: пары «ключ → значение» в БД.

Зачем таблица, а не `.env`: некоторые рубильники нужно переключать на живом
сервере — без правки файла и перезапуска контейнеров. Первый такой — режим
технических работ (``core/maintenance.py``); таблица общая, поэтому следующий
рубильник не потребует новой миграции.

Значение — JSON-строка: у разных настроек разная форма, а у техработ это
``{"enabled": …, "message": …, "since": …}``. Шифровать «в покое» его не нужно:
текст сообщения о техработах видит каждый посетитель (в отличие от личного
текста, за который отвечает ``EncryptedText``).
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class AppSetting(Base):
    """Одна служебная настройка сервиса."""

    __tablename__ = "app_settings"

    #: Имя настройки (латиницей, например ``maintenance``).
    key: Mapped[str] = mapped_column(String(64), primary_key=True)

    #: Значение в формате JSON.
    value: Mapped[str] = mapped_column(Text, nullable=False)

    #: Кто и когда последний раз менял настройку (для разбора «кто включил»).
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
