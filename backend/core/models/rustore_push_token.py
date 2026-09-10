"""Модель push-токена RuStore (Android-приложение Pismo).

Android-приложение получает push-токен через RuStore Push SDK и регистрирует его
здесь. Это второй канал уведомлений помимо Web Push: браузер (PWA) продолжает
получать их через push-сервис браузера, а Android-оболочка — через RuStore
(``core/rustore_push.py``).
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class RuStorePushToken(Base):
    __tablename__ = "rustore_push_tokens"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # Токен устройства, выданный RuStore Push SDK (уникален для устройства).
    token: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
