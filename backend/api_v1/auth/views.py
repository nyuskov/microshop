"""Эндпоинты аутентификации: токены и OTP."""

import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.rate_limit import client_ip, enforce_limit, rate_limit_key, rate_limiter
from core import mailer, passwords
from core.celery_app import get_task
from core.config import settings
from core.models import TelegramBindLink, User, db_helper
from core.security import get_password_hash, verify_password

from ..tokens.schemas import Token
from ..users.crud import (
    create_user_by_phone_number,
    get_or_create_user_by_phone_number,
    get_user_by_email,
    get_user_by_id,
    get_user_by_phone_number,
)
from . import audit, email_codes, security_notifications
from .device import device_info
from .device_guard import (
    DeviceChallengeError,
    build_challenge,
    can_verify_by_email,
    decode_challenge,
    has_any_device,
    is_known_device,
)
from .jwt import get_jwt_strategy
from .login_guard import lockout_seconds, register_failure, reset_failures
from .otp_storage import (
    OtpVerifyResult,
    can_request_new_code,
    mark_phone_verify_lockout,
    phone_verify_locked_out,
    store_otp,
    verify_otp,
)
from .refresh_sessions import (
    issue_refresh_token,
    list_active_sessions,
    revoke_all_sessions,
    revoke_session,
)
from .schemas import (
    AuthChannelsResponse,
    AuthSessionSchema,
    AuthSessionsResponse,
    DeviceVerifyRequest,
    EmailAddressRequest,
    EmailCodeConfirmRequest,
    EmailLoginConfirmRequest,
    EmailLoginRequest,
    OTPResponse,
    PasswordRequest,
    PasswordResetConfirmRequest,
    PasswordSetRequest,
    PasswordSetResponse,
    PasswordStatusRequest,
    PasswordStatusResponse,
    RequestOTPRequest,
    SecurityLogEntry,
    SecurityLogResponse,
    SessionRevokeResponse,
    TokenResponse,
    VerifyOTPRequest,
)
from .utils import authenticate_user, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Аутентификация"])

PHONE_PATTERN = re.compile(
    r"^\+7\s?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{2})[\s.-]?(\d{2})$"
)

# Окно rate limiting для публичных auth-эндпоинтов (секунды).
_AUTH_LIMIT_WINDOW_SECONDS = 60


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


# --- 2FA: вход с нового устройства -----------------------------------------
# Политика — всегда требовать код (см. device_guard.py). Проверка стоит ПОСЛЕ
# проверки пароля/кода, но ДО выдачи токенов, поэтому «только пароль» больше не
# даёт доступ с незнакомого устройства.

_DEVICE_CHALLENGE_DETAIL = (
    "Вход с нового устройства. Мы отправили код на вашу почту — введите его, "
    "чтобы подтвердить этот вход."
)


async def _require_device_verification(
    session: AsyncSession, request: Request, user: User
) -> None:
    """Пропускает вход с известного устройства, иначе требует код из письма.

    Ничего не возвращает, если вход можно продолжать (устройство знакомо, это
    первый вход аккаунта либо подтвердить кодом нечем). Если устройство новое и
    подтверждение возможно — отправляет код и поднимает 428 с challenge-токеном.
    """
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


@router.post("/login/verify-device/", response_model=TokenResponse)
async def verify_device_login(
    request_data: DeviceVerifyRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> TokenResponse:
    """Второй шаг входа с нового устройства: код из письма → токены.

    Challenge-токен подписан сервером и привязан к подписи устройства, поэтому
    подтвердить вход можно только с того же браузера/приложения, с которого
    пришла попытка входа.
    """
    await _enforce_ip_limit(
        request,
        scope="auth:device-verify",
        limit=settings.auth_device_verify_limit_per_minute,
    )
    try:
        user_id, signature = decode_challenge(request_data.challenge_token)
    except DeviceChallengeError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Подтверждение входа недействительно. Войдите заново.",
        ) from exc

    info = device_info(request)
    if signature != info.signature:
        # Заявка выдана другому устройству — это попытка подтвердить чужой вход.
        logger.warning("Challenge устройства использован не с того устройства")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Подтверждение входа недействительно. Войдите заново.",
        )

    user = await get_user_by_id(session, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Подтверждение входа недействительно. Войдите заново.",
        )

    address = str(user.email or "")
    if not address:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Подтверждение входа недействительно. Войдите заново.",
        )

    await _consume_email_code(session, request, email=address, code=request_data.code)
    # Код из письма — уже доказательство владения ящиком, отдельное письмо «вход с
    # нового устройства» здесь было бы вторым письмом об одном действии.
    await security_notifications.remember_login_device(
        session, user, request, notify=False
    )
    await audit.log_security_event(
        session,
        event="device_verified",
        user_id=user.id,
        request=request,
        detail="вход с нового устройства подтверждён кодом из письма",
    )
    logger.info("Пользователь %s подтвердил вход с нового устройства", user.id)

    access_token = await get_jwt_strategy().write_token(user)
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        refresh_token=await issue_refresh_token(session, user_id=user.id, device=info),
    )


# --- Активные входы (устройства) -------------------------------------------


@router.get("/sessions/", response_model=AuthSessionsResponse)
async def list_sessions(
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> AuthSessionsResponse:
    """Активные входы аккаунта: устройство, IP, когда выполнен вход.

    «Текущий» вход определяется по подписи устройства (User-Agent): если в одном
    браузере несколько входов, они выглядят одинаково.
    """
    current_signature = device_info(request).signature
    rows = await list_active_sessions(session, user_id=user.id)
    return AuthSessionsResponse(
        sessions=[
            AuthSessionSchema(
                id=row.id,
                device=row.device_user_agent or "неизвестное устройство",
                ip=row.device_ip or "",
                created_at=row.created_at,
                current=bool(
                    row.device_signature and row.device_signature == current_signature
                ),
            )
            for row in rows
        ]
    )


@router.delete("/sessions/{session_id}/", response_model=SessionRevokeResponse)
async def revoke_one_session(
    session_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> SessionRevokeResponse:
    """Отзывает один вход (устройство). Свою же сессию тоже можно отозвать."""
    revoked = await revoke_session(session, user_id=user.id, session_id=session_id)
    if not revoked:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Вход не найден (возможно, уже завершён).",
        )
    logger.info("Пользователь %s отозвал сессию %s", user.id, session_id)
    await audit.log_security_event(
        session,
        event="session_revoked",
        user_id=user.id,
        detail=f"завершён вход с устройства (сессия #{session_id})",
    )
    return SessionRevokeResponse(detail="Устройство вышло из аккаунта.")


@router.get("/security-log/", response_model=SecurityLogResponse)
async def get_security_log(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> SecurityLogResponse:
    """Журнал безопасности аккаунта: что происходило (входы, смены, отзывы).

    Нужен владельцу для разбора: «кто-то заходил?», «когда сменили пароль?».
    Хранится ``audit.RETENTION_DAYS`` дней, отдаётся только самому пользователю.
    """
    rows = await audit.list_security_events(session, user_id=user.id, limit=limit)
    return SecurityLogResponse(
        items=[
            SecurityLogEntry(
                id=row.id,
                event=row.event,
                title=audit.EVENT_TITLES.get(row.event, row.event),
                detail=row.detail,
                ip=row.ip,
                device=row.device_user_agent or "",
                created_at=row.created_at,
            )
            for row in rows
        ]
    )


@router.post("/token/", response_model=Token)
async def login_for_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> Token:
    """Авторизует пользователя и возвращает access-токен."""
    await _enforce_ip_limit(
        request,
        scope="auth:token",
        limit=settings.auth_token_login_limit_per_minute,
    )
    user = await authenticate_user(
        form_data.username,
        form_data.password,
        session,
    )
    if user is None:
        await audit.log_security_event(
            session,
            event="login_failed",
            user_id=None,
            request=request,
            detail=f"неверные учётные данные (логин/номер: {form_data.username[:40]})",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверное имя пользователя или пароль",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Вход с нового устройства требует код из письма (политика — всегда).
    await _require_device_verification(session, request, user)
    await audit.log_security_event(
        session, event="login_success", user_id=user.id, request=request
    )
    access_token = await get_jwt_strategy().write_token(user)
    return Token(
        access_token=access_token,
        token_type="bearer",
        refresh_token=await issue_refresh_token(
            session, user_id=user.id, device=device_info(request)
        ),
    )


@router.post("/request-otp/", response_model=OTPResponse)
async def request_otp(
    request_data: RequestOTPRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> OTPResponse:
    """Запрашивает OTP-код для номера телефона (с кулдауном повторной отправки)."""
    await _enforce_ip_limit(
        request,
        scope="auth:request-otp",
        limit=settings.auth_otp_request_limit_per_minute,
    )
    phone_number = request_data.phone_number

    if not validate_phone_number_format(phone_number):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неверный формат номера телефона. Ожидается +7 (___) ___-__-__.",
        )

    cooldown = settings.auth_otp_resend_cooldown_seconds
    if not await can_request_new_code(
        session, phone_number=phone_number, cooldown_seconds=cooldown
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Код уже отправлен. Повторите запрос через {cooldown} секунд.",
            headers={"Retry-After": str(cooldown)},
        )

    # Часовой лимит запросов кода на конкретный номер (независимо от IP).
    # Проверяем ПОСЛЕ кулдауна, чтобы неудачные попытки (заблокированные
    # кулдауном) не расходовали «бюджет» номера.
    phone_hour_limit = settings.auth_otp_request_per_phone_per_hour
    if not await rate_limiter.allow(
        rate_limit_key("auth:request-otp-phone", phone_number),
        limit=phone_hour_limit,
        window_seconds=3600,
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Слишком много запросов кода на этот номер за последний час. "
                "Попробуйте позже."
            ),
            headers={"Retry-After": "3600"},
        )

    # Суточные лимиты: защита баланса SMS-шлюза. Каждый отправленный код стоит
    # денег, а эндпоинт публичный, поэтому сначала ограничиваем конкретный
    # источник (IP), затем — весь сервис целиком.
    client_host = client_ip(request)
    await enforce_limit(
        scope="auth:request-otp-daily-ip",
        value=client_host,
        limit=settings.auth_otp_per_ip_daily_limit,
        window_seconds=86400,
        detail=(
            "Слишком много запросов кода с вашего адреса за сутки. "
            "Попробуйте завтра или напишите на nyuskov@gmail.com."
        ),
    )
    global_daily_limit = settings.auth_otp_daily_limit
    if not await rate_limiter.allow(
        rate_limit_key("auth:request-otp-daily", "total"),
        limit=global_daily_limit,
        window_seconds=86400,
    ):
        logger.warning(
            "Дневной лимит отправки кодов исчерпан (%s) — коды не отправляются",
            global_daily_limit,
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "На сегодня коды не отправляются: исчерпан дневной лимит сервиса. "
                "Напишите на nyuskov@gmail.com."
            ),
            headers={"Retry-After": "3600"},
        )

    otp_code = generate_otp_code()
    await store_otp(
        session,
        phone_number=phone_number,
        code=otp_code,
        ttl_seconds=settings.auth_otp_expire_seconds,
    )
    enqueue_sms_otp(phone_number, otp_code)
    otp_owner = await get_user_by_phone_number(session, phone_number)
    await audit.log_security_event(
        session,
        event="otp_requested",
        user_id=otp_owner.id if otp_owner is not None else None,
        request=request,
        detail="код подтверждения запрошен на номер аккаунта",
    )

    return OTPResponse(detail="Код OTP отправлен.")


@router.post("/verify-otp/", response_model=TokenResponse)
async def verify_otp_endpoint(
    request_data: VerifyOTPRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> TokenResponse:
    """Верифицирует OTP-код и выдаёт токен (с ограничением числа попыток)."""
    await _enforce_ip_limit(
        request,
        scope="auth:verify-otp",
        limit=settings.auth_otp_verify_limit_per_minute,
    )
    phone_number = request_data.phone_number

    # Блокировка номера после перебора: не даём сразу запросить новый код
    # и продолжить подбор.
    if phone_verify_locked_out(phone_number):
        lockout = settings.auth_otp_verify_lockout_seconds
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Слишком много неверных попыток. " f"Попробуйте через {lockout} секунд."
            ),
            headers={"Retry-After": str(lockout)},
        )

    result = await verify_otp(
        session,
        phone_number=phone_number,
        code=request_data.otp,
        max_attempts=settings.auth_otp_max_attempts,
    )
    if result is not OtpVerifyResult.OK:
        if result is OtpVerifyResult.TOO_MANY:
            # Код «сгорел» — ставим номер на паузу от дальнейшего перебора.
            mark_phone_verify_lockout(
                phone_number,
                duration_seconds=settings.auth_otp_verify_lockout_seconds,
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Слишком много неверных попыток. Запросите новый код.",
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный или истёкший код OTP.",
        )

    user = await get_or_create_user_by_phone_number(session, phone_number)
    # Подтверждённый номер — первый фактор; новое устройство требует код с почты.
    await _require_device_verification(session, request, user)
    await audit.log_security_event(
        session,
        event="login_success",
        user_id=user.id,
        request=request,
        detail="вход по коду на телефон",
    )
    access_token = await get_jwt_strategy().write_token(user)
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        refresh_token=await issue_refresh_token(
            session, user_id=user.id, device=device_info(request)
        ),
    )


# --- Вход по паролю ------------------------------------------------------
# Основной способ входа после подтверждения номера кодом. Правила пароля — в
# ``core/passwords.py`` (длина, чёрный список, запрет данных аккаунта).


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


@router.post("/password/status/", response_model=PasswordStatusResponse)
async def password_status(
    request_data: PasswordStatusRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> PasswordStatusResponse:
    """Есть ли у номера аккаунт и задан ли для него пароль."""
    await _enforce_ip_limit(request, scope="auth:password-status", limit=30)
    phone_number = request_data.phone_number
    if not validate_phone_number_format(phone_number):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неверный формат номера телефона.",
        )
    user = await get_user_by_phone_number(session, phone_number)
    email_channel = email_otp_available()
    if user is None:
        return PasswordStatusResponse(
            registered=False,
            has_password=False,
            otp_available=otp_delivery_available(None),
            email_otp_available=email_channel,
            email_login_available=False,
        )
    return PasswordStatusResponse(
        registered=True,
        has_password=user.password_set,
        otp_available=otp_delivery_available(user),
        email_otp_available=email_channel,
        email_login_available=bool(email_channel and user.email_verified),
    )


@router.post("/password/register/", response_model=TokenResponse)
async def register_with_password(
    request_data: PasswordRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> TokenResponse:
    """Создаёт пароль для номера (и аккаунт, если его нет) и сразу входит."""
    await _enforce_ip_limit(request, scope="auth:password-register", limit=10)
    phone_number = request_data.phone_number
    if not validate_phone_number_format(phone_number):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неверный формат номера телефона.",
        )
    password = _validate_new_password(request_data.password, phone_number=phone_number)

    user = await get_user_by_phone_number(session, phone_number)
    if user is not None and user.password_set:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="У этого номера уже есть пароль. Войдите с ним.",
        )

    hashed = get_password_hash(password)
    if user is None:
        user = await create_user_by_phone_number(session, phone_number, hashed)
    else:
        # Аккаунт создан ранее через OTP: задаём «настоящий» пароль.
        user.hashed_password = hashed
        user.password_set = True
        user.password_weak = False
        await session.commit()

    # Если аккаунт уже существовал и с него входили с других устройств, установка
    # пароля — тоже новый вход и требует код из письма.
    await _require_device_verification(session, request, user)
    access_token = await get_jwt_strategy().write_token(user)
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        refresh_token=await issue_refresh_token(
            session, user_id=user.id, device=device_info(request)
        ),
    )


@router.post("/password/login/", response_model=TokenResponse)
async def password_login(
    request_data: PasswordRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> TokenResponse:
    """Вход по номеру телефона и паролю."""
    await _enforce_ip_limit(
        request,
        scope="auth:password-login",
        limit=settings.auth_token_login_limit_per_minute,
    )
    phone_number = request_data.phone_number
    if not validate_phone_number_format(phone_number):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неверный формат номера телефона.",
        )

    # Блокировка аккаунта после серии неудач: лимит по IP обходится сменой
    # адреса, поэтому считаем неудачи на сам номер (см. login_guard.py).
    locked_for = await lockout_seconds(session, identifier=phone_number)
    if locked_for > 0:
        await audit.log_security_event(
            session,
            event="login_locked",
            user_id=None,
            request=request,
            detail=f"блокировка перебора активна ещё {locked_for} с",
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Слишком много неверных попыток входа. "
                f"Повторите через {locked_for} сек."
            ),
            headers={"Retry-After": str(locked_for)},
        )

    user = await authenticate_user(phone_number, request_data.password, session)
    if user is None or not user.password_set:
        await register_failure(session, identifier=phone_number)
        # Событие привязываем к аккаунту, если номер зарегистрирован: владелец
        # должен видеть попытки подбора пароля к своему аккаунту.
        failed_owner = await get_user_by_phone_number(session, phone_number)
        await audit.log_security_event(
            session,
            event="login_failed",
            user_id=failed_owner.id if failed_owner is not None else None,
            request=request,
            detail="вход по паролю: неверный номер или пароль",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный номер или пароль.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    await reset_failures(session, identifier=phone_number)

    # Пароль пришёл в открытом виде — единственный момент, когда можно проверить
    # его по текущей политике (у нас хранится только хеш). Если он слабый (пароль
    # задан до появления политики) — ставим флаг: фронт предложит его сменить.
    weak = (
        passwords.password_problem(
            request_data.password,
            phone_number=user.phone_number,
            email=user.email,
            username=user.username,
        )
        is not None
    )
    if weak != user.password_weak:
        user.password_weak = weak
        await session.commit()

    await _require_device_verification(session, request, user)
    await audit.log_security_event(
        session,
        event="login_success",
        user_id=user.id,
        request=request,
        detail="вход по паролю",
    )
    access_token = await get_jwt_strategy().write_token(user)
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        refresh_token=await issue_refresh_token(
            session, user_id=user.id, device=device_info(request)
        ),
    )


@router.post("/password/set/", response_model=PasswordSetResponse)
async def set_password(
    request_data: PasswordSetRequest,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> PasswordSetResponse:
    """Задаёт (или меняет) пароль текущего пользователя.

    Основной сценарий — первый вход: пользователь подтвердил номер по OTP и
    теперь задаёт пароль, чтобы дальше входить без кода (дешевле и быстрее).
    Если пароль уже есть, требуется ``current_password``.

    ВАЖНО: смена пароля отзывает ВСЕ refresh-сессии (если пароль сменили из-за
    подозрения на взлом, остальные устройства должны вылететь), поэтому в ответе
    приходит новая пара токенов — текущее устройство остаётся в системе.
    """
    await _enforce_ip_limit(request, scope="auth:password-set", limit=10)
    password = _validate_new_password(
        request_data.password,
        phone_number=user.phone_number,
        email=user.email,
        username=user.username,
    )

    if user.password_set:
        current = request_data.current_password or ""
        if not verify_password(current, user.hashed_password):
            # 400, а не 401: 401 на фронте запускает авто-обновление токена.
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Текущий пароль указан неверно.",
            )

    user.hashed_password = get_password_hash(password)
    user.password_set = True
    user.password_weak = False
    await session.commit()

    # Все прочие устройства разлогиниваем, текущему выдаём новые токены.
    await revoke_all_sessions(session, user_id=user.id)
    await security_notifications.notify_security_event(
        session,
        user,
        event="password_changed",
        request=request,
        details=(
            "Пароль аккаунта изменён, вход на всех остальных устройствах "
            f"прекращён.\nIP-адрес: {client_ip(request) or 'неизвестен'}"
        ),
    )
    access_token = await get_jwt_strategy().write_token(user)
    logger.info("Пароль задан пользователем %s, остальные сессии отозваны", user.id)
    await audit.log_security_event(
        session,
        event="password_changed",
        user_id=user.id,
        request=request,
        detail="пароль изменён, остальные сессии отозваны",
    )
    return PasswordSetResponse(
        detail="Пароль сохранён. Остальные устройства вышли из аккаунта.",
        access_token=access_token,
        token_type="bearer",
        refresh_token=await issue_refresh_token(
            session, user_id=user.id, device=device_info(request)
        ),
    )


@router.post("/sessions/revoke-all/", response_model=PasswordSetResponse)
async def revoke_sessions(
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> PasswordSetResponse:
    """Выходит из аккаунта на всех устройствах (кроме текущего запроса).

    Текущий access-токен продолжает работать до истечения (30 мин), но его
    refresh-сессия тоже отозвана, так что продлить вход не получится — фронт
    после этого чистит токены и уводит на экран входа.
    """
    await _enforce_ip_limit(request, scope="auth:revoke-all", limit=10)
    await revoke_all_sessions(session, user_id=user.id)
    await security_notifications.notify_security_event(
        session,
        user,
        event="sessions_revoked",
        request=request,
        details=f"IP-адрес запроса: {client_ip(request) or 'неизвестен'}",
    )
    logger.info("Пользователь %s отозвал все сессии", user.id)
    await audit.log_security_event(
        session,
        event="sessions_revoked",
        user_id=user.id,
        request=request,
        detail="выход на всех устройствах",
    )
    return PasswordSetResponse(detail="Вы вышли на всех устройствах.")


# --- E-mail: подтверждение адреса, вход по коду и сброс пароля -------------
# Адрес вторичен по отношению к номеру телефона (номер подтверждается кодом в
# Telegram), но именно он спасает, когда человек забыл пароль или потерял доступ
# к Telegram. Поэтому использовать его как канал можно ТОЛЬКО после подтверждения
# кодом из письма — иначе аккаунт угонялся бы через чужую/подставную почту.

_EMAIL_CODE_SUBJECT = "Pismo: код подтверждения"
# Одинаковый ответ на «запрос кода» — чтобы нельзя было узнать, есть ли у нас
# такой адрес (защита от перебора базы пользователей).
_EMAIL_REQUEST_DETAIL = "Если адрес привязан к аккаунту, письмо с кодом отправлено."


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
    enqueue_email_code(
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


@router.get("/channels/", response_model=AuthChannelsResponse)
async def auth_channels(request: Request) -> AuthChannelsResponse:
    """Публичный список доступных каналов доставки кодов (для экрана входа)."""
    await _enforce_ip_limit(request, scope="auth:channels", limit=60)
    return AuthChannelsResponse(
        otp_available=otp_delivery_available(None),
        email_otp_available=email_otp_available(),
    )


@router.post("/email/request-verification/", response_model=OTPResponse)
async def request_email_verification(
    request_data: EmailAddressRequest,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> OTPResponse:
    """Отправляет код на адрес, чтобы привязать и подтвердить его в аккаунте."""
    await _enforce_ip_limit(request, scope="auth:email-verification", limit=10)
    if not email_otp_available():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Отправка писем не настроена на сервере.",
        )

    address = email_codes.normalize_email(str(request_data.email))
    owner = await get_user_by_email(session, address)
    if owner is not None and owner.id != user.id and owner.email_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Этот e-mail уже привязан к другому аккаунту.",
        )

    await _issue_email_code(
        session,
        request,
        email=address,
        purpose="Подтверждение адреса e-mail в Pismo.",
        user_id=user.id,
    )
    return OTPResponse(detail=f"Код отправлен на {mailer.mask_email(address)}.")


@router.post("/email/confirm-verification/", response_model=OTPResponse)
async def confirm_email_verification(
    request_data: EmailCodeConfirmRequest,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> OTPResponse:
    """Подтверждает адрес кодом из письма и привязывает его к аккаунту."""
    address = email_codes.normalize_email(str(request_data.email))

    # Проверки делаем ДО расхода кода: иначе неудачная попытка сожгла бы код.
    owner = await get_user_by_email(session, address)
    if owner is not None and owner.id != user.id and owner.email_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Этот e-mail уже привязан к другому аккаунту.",
        )

    await _consume_email_code(session, request, email=address, code=request_data.code)

    user.email = address
    user.email_verified = True
    await session.commit()
    logger.info("Пользователь %s подтвердил e-mail", user.id)
    await audit.log_security_event(
        session,
        event="email_verified",
        user_id=user.id,
        request=request,
        detail="адрес e-mail подтверждён кодом из письма",
    )
    return OTPResponse(detail="Адрес подтверждён.")


@router.post("/email/login/request/", response_model=OTPResponse)
async def request_email_login(
    request_data: EmailLoginRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> OTPResponse:
    """Вход без пароля: код на подтверждённый e-mail аккаунта."""
    await _enforce_ip_limit(request, scope="auth:email-login", limit=10)
    if not email_otp_available():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Вход по e-mail не настроен на сервере.",
        )

    address = email_codes.normalize_email(str(request_data.email))
    cooldown = settings.auth_email_resend_cooldown_seconds
    if not await email_codes.can_request_email_code(
        session, email=address, cooldown_seconds=cooldown
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Код уже отправлен. Повторите через {cooldown} секунд.",
            headers={"Retry-After": str(cooldown)},
        )

    user = await get_user_by_email(session, address)
    # Отвечаем одинаково независимо от того, есть ли такой подтверждённый адрес:
    # иначе этот эндпоинт превращается в проверку «зарегистрирован ли e-mail».
    if user is not None and user.email_verified:
        await _issue_email_code(
            session,
            request,
            email=address,
            purpose="Вход в Pismo по коду из письма.",
            user_id=user.id,
        )
    else:
        logger.info("Запрошен вход по e-mail, но адрес не подтверждён: %s", address)

    return OTPResponse(detail=_EMAIL_REQUEST_DETAIL)


@router.post("/email/login/confirm/", response_model=TokenResponse)
async def confirm_email_login(
    request_data: EmailLoginConfirmRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> TokenResponse:
    """Проверяет код из письма и выдаёт токены (вход без пароля)."""
    address = email_codes.normalize_email(str(request_data.email))
    user = await get_user_by_email(session, address)
    if user is None or not user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный или истёкший код из письма.",
        )

    await _consume_email_code(session, request, email=address, code=request_data.code)
    await reset_failures(session, identifier=address)

    await audit.log_security_event(
        session,
        event="login_success",
        user_id=user.id,
        request=request,
        detail="вход по коду из письма",
    )

    # Вход подтверждён кодом из письма (доказано владение ящиком), поэтому 2FA
    # на устройство не требуется: просто запоминаем устройство.
    await security_notifications.remember_login_device(
        session, user, request, notify=False
    )
    access_token = await get_jwt_strategy().write_token(user)
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        refresh_token=await issue_refresh_token(
            session, user_id=user.id, device=device_info(request)
        ),
    )


@router.post("/password/reset/request/", response_model=OTPResponse)
async def request_password_reset(
    request_data: EmailLoginRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> OTPResponse:
    """Восстановление доступа: код на подтверждённый e-mail аккаунта."""
    await _enforce_ip_limit(request, scope="auth:password-reset", limit=10)
    if not email_otp_available():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Восстановление по e-mail не настроено на сервере.",
        )

    address = email_codes.normalize_email(str(request_data.email))
    cooldown = settings.auth_email_resend_cooldown_seconds
    if not await email_codes.can_request_email_code(
        session, email=address, cooldown_seconds=cooldown
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Код уже отправлен. Повторите через {cooldown} секунд.",
            headers={"Retry-After": str(cooldown)},
        )

    user = await get_user_by_email(session, address)
    if user is not None and user.email_verified:
        await _issue_email_code(
            session,
            request,
            email=address,
            purpose="Сброс пароля Pismo.",
            user_id=user.id,
        )

    return OTPResponse(detail=_EMAIL_REQUEST_DETAIL)


@router.post("/password/reset/confirm/", response_model=TokenResponse)
async def confirm_password_reset(
    request_data: PasswordResetConfirmRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> TokenResponse:
    """Меняет пароль по коду из письма и сразу входит на этом устройстве.

    Все прежние сессии отзываются: сброс пароля обычно делают, когда есть
    подозрение на взлом, поэтому остальные устройства должны вылететь.
    """
    address = email_codes.normalize_email(str(request_data.email))
    user = await get_user_by_email(session, address)
    if user is None or not user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный или истёкший код из письма.",
        )

    # Пароль проверяем ДО расхода кода: иначе ошибка политики сожгла бы код.
    password = _validate_new_password(
        request_data.password,
        phone_number=user.phone_number,
        email=user.email,
        username=user.username,
    )
    await _consume_email_code(session, request, email=address, code=request_data.code)

    user.hashed_password = get_password_hash(password)
    user.password_set = True
    user.password_weak = False
    await session.commit()

    await revoke_all_sessions(session, user_id=user.id)
    await reset_failures(session, identifier=address)
    await security_notifications.notify_security_event(
        session,
        user,
        event="password_reset",
        request=request,
        details=(
            "Пароль восстановлен по коду из письма, прежние сессии отозваны.\n"
            f"IP-адрес: {client_ip(request) or 'неизвестен'}"
        ),
    )
    logger.info("Пользователь %s восстановил пароль по e-mail", user.id)
    await audit.log_security_event(
        session,
        event="password_reset",
        user_id=user.id,
        request=request,
        detail="пароль восстановлен по коду из письма, старые сессии отозваны",
    )

    # Код из письма подтверждает и владение ящиком, и это устройство.
    await security_notifications.remember_login_device(
        session, user, request, notify=False
    )
    access_token = await get_jwt_strategy().write_token(user)
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        refresh_token=await issue_refresh_token(
            session, user_id=user.id, device=device_info(request)
        ),
    )


# --- Привязка Telegram (резервный канал доставки OTP) ---------------------


@router.post("/telegram/bind/")
async def create_telegram_bind_link(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, str | None]:
    """Создаёт ссылку привязки Telegram-чата к аккаунту.

    Пользователь открывает ``t.me/<bot>?start=bind_<код>`` и жмёт Start — воркер
    (``tasks.telegram.telegram_poll_updates``) проставит ``tg_chat_id``, после
    чего коды входа будут приходить в Telegram даже без Telegram Gateway.
    Ссылка одноразовая и живёт ``telegram_bind_link_ttl_seconds``.
    """
    now = datetime.now(timezone.utc)
    code = secrets.token_hex(12)  # 24 hex-символа — влезает в payload start (64)
    session.add(
        TelegramBindLink(
            code=code,
            user_id=user.id,
            expires_at=now + timedelta(seconds=settings.telegram_bind_link_ttl_seconds),
        )
    )
    await session.commit()

    username = settings.telegram_bot_username
    deep_link = f"https://t.me/{username}?start=bind_{code}" if username else None
    return {"code": code, "deep_link": deep_link}


@router.get("/telegram/status/")
async def telegram_bind_status(
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    """Привязан ли Telegram-чат к аккаунту (для доставки кодов)."""
    return {"bound": user.tg_chat_id is not None}


@router.post("/telegram/unbind/")
async def unbind_telegram(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, bool]:
    """Отвязывает Telegram-чат от аккаунта."""
    if user.tg_chat_id is not None:
        user.tg_chat_id = None
        await session.commit()
    return {"bound": False}
