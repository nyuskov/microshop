"""Агрегатор эндпоинтов аутентификации.

Основная реализация разделена по доменным роутерам в ``api_v1.auth.routers``:
- ``otp.py`` — запрос/проверка OTP-кодов телефона, каналы, разморозка;
- ``password.py`` — парольная регистрация, вход, смена и сброс пароля;
- ``email_codes.py`` — подтверждение почты и вход по коду из письма;
- ``devices.py`` — верификация 2FA нового устройства и привязка Telegram;
- ``sessions.py`` — активные сессии, выход, журнал безопасности, заморозка и паника.
"""

from .common import (
    _AUTH_LIMIT_WINDOW_SECONDS,
    _DEVICE_CHALLENGE_DETAIL,
    _EMAIL_CODE_SUBJECT,
    _EMAIL_REQUEST_DETAIL,
    PHONE_PATTERN,
    _consume_email_code,
    _email_code_body,
    _enforce_ip_limit,
    _ensure_active,
    _issue_email_code,
    _require_device_verification,
    _validate_new_password,
    email_otp_available,
    enqueue_email_code,
    enqueue_sms_otp,
    generate_otp_code,
    otp_delivery_available,
    validate_phone_number_format,
)
from .routers import (
    devices_router,
    email_codes_router,
    otp_router,
    password_router,
    router,
    sessions_router,
)

__all__ = [
    "PHONE_PATTERN",
    "_AUTH_LIMIT_WINDOW_SECONDS",
    "_DEVICE_CHALLENGE_DETAIL",
    "_EMAIL_CODE_SUBJECT",
    "_EMAIL_REQUEST_DETAIL",
    "_consume_email_code",
    "_email_code_body",
    "_enforce_ip_limit",
    "_ensure_active",
    "_issue_email_code",
    "_require_device_verification",
    "_validate_new_password",
    "devices_router",
    "email_codes_router",
    "email_otp_available",
    "enqueue_email_code",
    "enqueue_sms_otp",
    "generate_otp_code",
    "otp_delivery_available",
    "otp_router",
    "password_router",
    "router",
    "sessions_router",
    "validate_phone_number_format",
]
