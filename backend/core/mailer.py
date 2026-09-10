"""Отправка писем (коды подтверждения, восстановление доступа).

Синхронный SMTP-клиент: вызывается из воркера Celery (см. ``tasks/otp_tasks``),
чтобы HTTP-запрос не ждал сеть, а отправку можно было ретраить. Если SMTP не
настроен (dev/локальный запуск) — код печатается в лог воркера, как и SMS-заглушка.
"""

import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from core.config import settings

logger = logging.getLogger(__name__)

_SMTP_TIMEOUT = 15


class MailerError(Exception):
    """Ошибка отправки письма (не фатальна: воркер логирует и уходит в fallback)."""


def is_configured() -> bool:
    """Настроена ли отправка писем (есть SMTP-хост и адрес отправителя)."""
    return bool(settings.smtp_host and settings.smtp_from)


def mask_email(email: str) -> str:
    """Маскирует адрес для логов: ``ivan@mail.ru`` → ``iv***@mail.ru``."""
    name, _, domain = email.partition("@")
    if not domain:
        return "***"
    return f"{name[:2]}***@{domain}"


def send_email(to: str, subject: str, text: str) -> None:
    """Отправляет письмо. При любой ошибке поднимает :class:`MailerError`."""
    host = settings.smtp_host
    sender = settings.smtp_from
    if not host or not sender:
        raise MailerError("SMTP не настроен")

    message = EmailMessage()
    message["From"] = formataddr((settings.smtp_from_name, sender))
    message["To"] = to
    message["Subject"] = subject
    message.set_content(text)

    context = ssl.create_default_context()
    try:
        if settings.smtp_ssl:
            with smtplib.SMTP_SSL(
                host,
                settings.smtp_port,
                timeout=_SMTP_TIMEOUT,
                context=context,
            ) as server:
                _login_and_send(server, message)
        else:
            with smtplib.SMTP(
                host, settings.smtp_port, timeout=_SMTP_TIMEOUT
            ) as server:
                if settings.smtp_starttls:
                    server.starttls(context=context)
                _login_and_send(server, message)
    except (OSError, smtplib.SMTPException, ValueError) as exc:
        raise MailerError(str(exc)) from exc


def _login_and_send(server: smtplib.SMTP, message: EmailMessage) -> None:
    """Логинится (если задан логин) и отправляет готовое письмо."""
    if settings.smtp_user:
        server.login(settings.smtp_user, settings.smtp_password or "")
    server.send_message(message)
