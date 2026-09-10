"""Журнал безопасности аккаунта: что происходило с аккаунтом.

Зачем: при разборе инцидента («кто-то заходил в мой аккаунт? когда сменили
пароль?») ответа не было нигде — события жили только в логах контейнера, которые
ротируются и недоступны пользователю. Теперь значимые события складываются в БД и
показываются владельцу в профиле («Безопасность» → «Последние действия»).

Пишем только то, что нужно для разбора: тип события, время, IP, отпечаток
устройства (sha256 от User-Agent) и короткую заметку. Никакого содержимого
сообщений и паролей — в ``detail`` попадают только безопасные для БД вещи
(например, «устройство подтверждено кодом из письма»).

Записи не удаляются при смене данных аккаунта (``user_id`` сбрасывается по
``ON DELETE SET NULL``): сам факт «с аккаунта входили» важен и после удаления.
Старые записи подчищает периодическая задача (см. ``tasks/security_tasks.py``).
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

# Типы событий (коды; человекочитаемые подписи — в api_v1/auth/audit.py).
EVENT_LOGIN_SUCCESS = "login_success"
EVENT_LOGIN_FAILED = "login_failed"
EVENT_LOGIN_LOCKED = "login_locked"
EVENT_OTP_REQUESTED = "otp_requested"
EVENT_EMAIL_CODE_REQUESTED = "email_code_requested"
EVENT_DEVICE_CHALLENGE = "device_challenge"
EVENT_DEVICE_VERIFIED = "device_verified"
EVENT_DEVICE_UNVERIFIED = "device_unverified"
EVENT_PASSWORD_CHANGED = "password_changed"
EVENT_PASSWORD_RESET = "password_reset"
EVENT_EMAIL_CHANGED = "email_changed"
EVENT_EMAIL_VERIFIED = "email_verified"
EVENT_SESSIONS_REVOKED = "sessions_revoked"
EVENT_SESSION_REVOKED = "session_revoked"
EVENT_ACCOUNT_DELETED = "account_deleted"

SECURITY_EVENTS = frozenset(
    {
        EVENT_LOGIN_SUCCESS,
        EVENT_LOGIN_FAILED,
        EVENT_LOGIN_LOCKED,
        EVENT_OTP_REQUESTED,
        EVENT_EMAIL_CODE_REQUESTED,
        EVENT_DEVICE_CHALLENGE,
        EVENT_DEVICE_VERIFIED,
        EVENT_DEVICE_UNVERIFIED,
        EVENT_PASSWORD_CHANGED,
        EVENT_PASSWORD_RESET,
        EVENT_EMAIL_CHANGED,
        EVENT_EMAIL_VERIFIED,
        EVENT_SESSIONS_REVOKED,
        EVENT_SESSION_REVOKED,
        EVENT_ACCOUNT_DELETED,
    }
)


class SecurityEvent(Base):
    """Одно событие безопасности аккаунта (append-only)."""

    __tablename__ = "security_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # NULL — если аккаунт уже удалён (событие остаётся для истории).
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True, index=True
    )
    event: Mapped[str] = mapped_column(String(40), index=True)
    ip: Mapped[str] = mapped_column(String(64), default="")
    # sha256 от User-Agent: то же «устройство», что и в login_devices.
    device_signature: Mapped[str] = mapped_column(String(64), default="")
    device_user_agent: Mapped[str] = mapped_column(String(255), default="")
    # Короткая заметка без секретов (что именно произошло).
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
