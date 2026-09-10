"""Модель учёта неудачных входов по паролю (защита от перебора аккаунта).

Лимиты «по IP» не спасают от перебора с разных адресов, поэтому считаем неудачи
на конкретный идентификатор входа (номер телефона или логин) и временно
блокируем его с растущей задержкой.
"""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PasswordLoginAttempt(Base):
    """Счётчик неудачных входов по паролю для одного идентификатора."""

    __tablename__ = "password_login_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Номер телефона или логин — то, что ввёл пользователь (в нижнем регистре).
    identifier: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    # До какого момента вход заблокирован (None — не заблокирован).
    locked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_failed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
