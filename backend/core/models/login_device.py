"""Модель «известных устройств входа» (для уведомлений о новых входах).

Хранится только отпечаток браузера/приложения (sha256 от User-Agent), чтобы
уведомлять владельца про вход с нового устройства, и он мог вовремя заметить
чужой доступ. Ничего похожего на «уникальный идентификатор устройства» мы не
собираем: отпечаток меняется при обновлении браузера — тогда владелец получит
письмо ещё раз (лучше лишнее письмо, чем незамеченный вход).

Таблица также станет основой для списка активных сессий (P1-roadmap).
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class LoginDevice(Base):
    """Устройство, с которого пользователь уже входил (отпечаток + последний IP)."""

    __tablename__ = "login_devices"
    __table_args__ = (
        UniqueConstraint("user_id", "signature", name="uq_login_device_user_signature"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    # sha256(User-Agent); одинаков для одного и того же браузера на устройстве.
    signature: Mapped[str] = mapped_column(String(64))
    # «Человекочитаемое» описание для письма и (в будущем) списка сессий.
    user_agent: Mapped[str] = mapped_column(String(255), default="")
    last_ip: Mapped[str] = mapped_column(String(64), default="")
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
