"""Общие хелперы, константы и проверки для auth-роутеров."""

import logging
import re
import secrets

from fastapi import HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from core import mailer, passwords
from core.celery_app import get_task
from core.config import settings
from core.models import User
from core.rate_limit import client_ip, enforce_limit, rate_limit_key, rate_limiter

from . import audit, email_codes, security_notifications
from .device import device_info
from .device_guard import (
    build_challenge,
    can_verify_by_email,
    has_any_device,
    is_known_device,
)
from .utils import frozen_account_error

logger = logging.getLogger(__name__)

PHONE_PATTERN = re.compile(
    r"^\+7\s?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{2})[\s.-]?(\d{2})$"
)

# Окно rate limiting для публичных auth-эндпоинтов (секунды).
_AUTH_LIMIT_WINDOW_SECONDS = 60

_DEVICE_CHALLENGE_DETAIL = (
    "Вход с нового устройства. Мы отправили код на вашу почту — введите его, "
    "чтобы подтвердить этот вход."
)

_EMAIL_CODE_SUBJECT = "Pismo: код подтверждения"
_EMAIL_REQUEST_DETAIL = "Если адрес привязан к аккаунту, письмо с кодом отправлено."


async def _enforce_ip_limit(request: Request, *, scope: str, limit: int) -> None:
    """Ограничивает число запросов с одного IP за окно времени."""
    await enforce_limit(
        scope=scope,
        value=client_ip(request),
        limit=limit,
        window_seconds=_AUTH_LIMIT_WINDOW_SECONDS,
        detail="Слишком много запросов. Попробуйте позже.",
    )


def generate_otp_code() -> str:
    """Генерирует 6-значный числовой OTP-код."""
    return f"{secrets.randbelow(1_000_000):06d}"


def _ensure_active(user: User) -> None:
    """Не пускает замороженный аккаунт (кроме явной разморозки по коду).

    Заморозка — «стоп-кран» на случай угона: если бы входы её игнорировали,
    вор просто зашёл бы заново, и смысла в заморозке не было бы.
    """
    if not user.is_active:
        raise frozen_account_error()


def validate_phone_number_format(phone_number: str) -> bool:
    """Проверяет формат номера телефона."""
    return bool(PHONE_PATTERN.match(phone_number))


def otp_delivery_available(user: User | None) -> bool:
    """Можно ли доставить OTP-код на этот номер.

    Каналы завязаны на сам номер (Telegram-аккаунт на этом номере или телефон),
    а не на e-mail: так чужой номер зарегистрировать не получится — код получит
    только владелец. SMS Aero шлёт код сначала в Telegram (≈2,5 ₽) с автооткатом
    на SMS (≈9 ₽), Telegram Gateway — верификационное сообщение. Обычный
    Telegram-бот считается каналом только для аккаунтов с привязанным чатом
    (``tg_chat_id``), поэтому новому номеру он недоступен.
    """
    if settings.sms_aero_email and settings.sms_aero_api_key:
        return True
    if settings.telegram_gateway_token:
        return True
    return bool(settings.telegram_bot_token and user and user.tg_chat_id)


def enqueue_sms_otp(phone_number: str, otp_code: str) -> None:
    """Кладёт доставку OTP-кода в очередь Celery (RabbitMQ).

    Доставку выполняет воркер (см. tasks/otp_tasks.py): код в Telegram
    (SMS Aero) → SMS Aero → Telegram Gateway → обычный бот → dev-лог. Здесь код
    печатаем ТОЛЬКО если не настроен ни один канал (чистый dev-запуск без
    ключей) — иначе код утёк бы в web-лог. Если брокер недоступен — вход не
    роняем: код уже виден выше (dev).
    """
    if (
        not settings.sms_aero_email
        and not settings.sms_aero_api_key
        and not settings.telegram_gateway_token
        and not settings.telegram_bot_token
    ):
        logger.info("SMS-заглушка (dev): OTP-код для %s -> %s", phone_number, otp_code)
    try:
        task = get_task("tasks.otp_tasks.send_sms_otp")
        task.delay(phone_number, otp_code)
    except Exception:  # noqa: BLE001 - брокер может быть недоступен (dev без docker)
        logger.warning(
            "RabbitMQ недоступен: задача SMS не поставлена в очередь "
            "(код отправки см. выше)"
        )


def email_otp_available() -> bool:
    """Включён ли канал писем (настроен SMTP и адрес отправителя)."""
    return mailer.is_configured()


def enqueue_email_code(email: str, code: str, subject: str, body: str) -> None:
    """Кладёт отправку письма с кодом в очередь Celery.

    Если SMTP не настроен — код уходит в лог web (dev-режим), чтобы сценарии
    подтверждения адреса/входа/сброса можно было проверить без почтового сервера.
    """
    if not mailer.is_configured():
        logger.info(
            "Почтовая заглушка (dev): код для %s -> %s",
            mailer.mask_email(email),
            code,
        )
    try:
        task = get_task("tasks.otp_tasks.send_email_code")
        task.delay(email, code, subject, body)
    except Exception:  # noqa: BLE001 - брокер может быть недоступен (dev без docker)
        logger.warning(
            "RabbitMQ недоступен: письмо с кодом не поставлено в очередь "
            "(код отправки см. выше)"
        )


def _email_code_body(code: str, purpose: str) -> str:
    """Текст письма с кодом: одна формулировка для всех сценариев."""
    minutes = max(1, settings.auth_otp_expire_seconds // 60)
    return (
        f"{purpose}\n\n"
        f"Код: {code}\n\n"
        f"Код действует {minutes} мин.\n"
        "Если вы не запрашивали код, просто игнорируйте это письмо."
    )


def _validate_new_password(
    password: str,
    *,
    phone_number: str | None = None,
    email: str | None = None,
    username: str | None = None,
) -> str:
    """Проверяет новый пароль политикой и возвращает его (или HTTP 400)."""
    problem = passwords.password_problem(
        password,
        phone_number=phone_number,
        email=email,
        username=username,
    )
    if problem:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=problem,
        )
    return password


async def _require_device_verification(
    session: AsyncSession, request: Request, user: User
) -> None:
    """Пропускает вход с известного устройства, иначе требует код из письма.

    Ничего не возвращает, если вход можно продолжать (устройство знакомо, это
    первый вход аккаунта либо подтвердить кодом нечем). Если устройство новое и
    подтверждение возможно — отправляет код и поднимает 428 с challenge-токеном.
    """
    # Замороженный аккаунт закрыт для всех способов входа: это «стоп-кран» при
    # угоне, и обойти его повторным входом нельзя. Разморозка — отдельный явный
    # шаг с кодом из письма (POST /account/unfreeze/).
    _ensure_active(user)

    if not await has_any_device(session, user_id=user.id):
        # Первое устройство аккаунта (регистрация) — подтверждать нечего.
        await security_notifications.remember_login_device(session, user, request)
        return

    if await is_known_device(session, user_id=user.id, device=device_info(request)):
        return

    if not can_verify_by_email(user):
        # Подтвердить вход нечем (нет подтверждённого e-mail или выключен SMTP).
        # Запирать человека вне собственного аккаунта нельзя, поэтому пропускаем,
        # но запоминаем устройство и шлём письмо-предупреждение (если адрес есть).
        logger.warning(
            "Вход с нового устройства без 2FA (нет подтверждённого e-mail): "
            "пользователь %s",
            user.id,
        )
        await audit.log_security_event(
            session,
            event="device_unverified",
            user_id=user.id,
            request=request,
            detail="новое устройство без 2FA: подтверждённого e-mail нет",
        )
        await security_notifications.remember_login_device(session, user, request)
        return

    info = device_info(request)
    address = str(user.email)
    # Кулдаун защищает от спама письмами, но здесь он мешал бы: каждый новый вход
    # = новый код. Если код отправляли только что, он ещё действует — показываем
    # шаг ввода; иначе отправляем новый (лимиты канала пробрасываем как есть,
    # ведь без письма подтвердить вход невозможно).
    cooldown = settings.auth_email_resend_cooldown_seconds
    if await email_codes.can_request_email_code(
        session, email=address, cooldown_seconds=cooldown
    ):
        await _issue_email_code(
            session,
            request,
            email=address,
            purpose=(
                "Подтверждение входа в Pismo с нового устройства.\n"
                f"Устройство: {info.label}"
            ),
            user_id=user.id,
        )
    else:
        logger.info(
            "Код для подтверждения устройства уже отправлен недавно (%s)", user.id
        )

    await audit.log_security_event(
        session,
        event="device_challenge",
        user_id=user.id,
        request=request,
        detail=f"новое устройство, код отправлен на {mailer.mask_email(address)}",
    )
    raise HTTPException(
        status_code=status.HTTP_428_PRECONDITION_REQUIRED,
        detail={
            "detail": _DEVICE_CHALLENGE_DETAIL,
            "code_sent_to": mailer.mask_email(address),
            "challenge_token": build_challenge(user_id=user.id, device=info),
            "expires_in": settings.auth_device_challenge_expire_seconds,
        },
    )


async def _issue_email_code(
    session: AsyncSession,
    request: Request,
    *,
    email: str,
    purpose: str,
    user_id: int | None = None,
) -> None:
    """Проверяет лимиты, генерирует код и ставит отправку письма в очередь.

    Лимиты: часовой на адрес, суточный общий (письма — публичный ресурс) и
    cooldown повторной отправки. Превышение → 429 с ``Retry-After``.

    ``user_id`` — владелец адреса (если известен): событие попадает в журнал
    безопасности его аккаунта, чтобы человек видел, когда для него запрашивали код.
    """
    address = email_codes.normalize_email(email)
    cooldown = settings.auth_email_resend_cooldown_seconds
    if not await email_codes.can_request_email_code(
        session, email=address, cooldown_seconds=cooldown
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=("Код уже отправлен. " f"Повторите запрос через {cooldown} секунд."),
            headers={"Retry-After": str(cooldown)},
        )

    await enforce_limit(
        scope="auth:email-code-address",
        value=address,
        limit=settings.auth_email_per_address_per_hour,
        window_seconds=3600,
        detail="Слишком много писем на этот адрес за час. Попробуйте позже.",
    )
    if not await rate_limiter.allow(
        rate_limit_key("auth:email-code-daily", "total"),
        limit=settings.auth_email_daily_limit,
        window_seconds=86400,
    ):
        logger.warning("Дневной лимит писем с кодами исчерпан")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="На сегодня письма с кодами не отправляются. Попробуйте завтра.",
            headers={"Retry-After": "3600"},
        )

    code = generate_otp_code()
    await email_codes.store_email_code(
        session,
        email=address,
        code=code,
        ttl_seconds=settings.auth_otp_expire_seconds,
    )
    await audit.log_security_event(
        session,
        event="email_code_requested",
        user_id=user_id,
        request=request,
        detail=f"код на {mailer.mask_email(address)}: {purpose.splitlines()[0][:120]}",
    )
    from . import views

    views.enqueue_email_code(
        address,
        code,
        _EMAIL_CODE_SUBJECT,
        _email_code_body(code, purpose),
    )


async def _consume_email_code(
    session: AsyncSession, request: Request, *, email: str, code: str
) -> None:
    """Проверяет код из письма, при неудаче бросает 401/429."""
    await _enforce_ip_limit(request, scope="auth:email-verify", limit=20)
    result = await email_codes.verify_email_code(
        session,
        email=email,
        code=code,
        max_attempts=settings.auth_email_verify_max_attempts,
    )
    if result is email_codes.EmailVerifyResult.OK:
        return
    if result is email_codes.EmailVerifyResult.TOO_MANY:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много неверных кодов. Запросите новый.",
        )
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Неверный или истёкший код из письма.",
    )
