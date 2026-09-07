"""Модель refresh-сессий (отзыв/ротация refresh-токенов)."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class RefreshSession(Base):
    """Активная refresh-сессия пользователя.

    В БД хранится хеш ``jti`` из refresh-токена (сам токен не хранится). При
    ротации старая сессия помечается ``revoked_at`` и ``replaced_by``; повторное
    использование уже «сгоревшего» токена (детект кражи) отзывает все сессии
    пользователя.
    """

    __tablename__ = "refresh_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    jti_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    replaced_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
