"""Модель Web Push-подписки браузера (PWA) для одного пользователя.

Каждый клиент (устройство/браузер), разрешивший push-уведомления, регистрирует
здесь свою подписку (endpoint + ключи шифрования). При новых сообщениях воркер
шлёт через endpoint push-уведомление (см. ``tasks/notifications.py``).
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # Адрес push-сервиса, на который шлём уведомление (уникален для подписки).
    endpoint: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    # Ключи шифрования сообщения (из PushSubscription.getKey('p256dh'/'auth')).
    p256dh: Mapped[str] = mapped_column(String(256), nullable=False)
    auth: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
