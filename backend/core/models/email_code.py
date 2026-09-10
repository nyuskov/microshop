"""Модель кодов подтверждения, отправленных на e-mail.

Аналог ``otp_codes`` для почты: хранит хеш кода и число попыток, привязанные к
адресу. Используется для подтверждения адреса, входа без пароля и восстановления
доступа.
"""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class EmailCode(Base):
    """Код подтверждения для конкретного адреса e-mail."""

    __tablename__ = "email_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    # SHA-256 от кода с секретом приложения; сам код в БД не хранится.
    code_hash: Mapped[str] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
