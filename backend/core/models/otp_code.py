"""Модель OTP-кодов в БД (вместо in-memory хранилища)."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class OtpCode(Base):
    """Одноразовый код для входа по телефону.

    Вместо хранения в памяти код лежит в БД — переживает рестарт и работает при
    нескольких воркерах. Сам код не хранится: только его хеш, количество попыток
    ввода и время жизни.
    """

    __tablename__ = "otp_codes"

    phone_number: Mapped[str] = mapped_column(String(20), primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    # Количество неудачных попыток ввода (защита от перебора).
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Момент последней отправки кода — для кулдауна повторного запроса.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
