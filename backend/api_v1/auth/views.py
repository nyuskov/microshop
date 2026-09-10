"""Эндпоинты аутентификации: токены и OTP."""

import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.rate_limit import enforce_limit, rate_limit_key, rate_limiter
from core.celery_app import get_task
from core.config import settings
from core.models import TelegramBindLink, User, db_helper
from core.security import get_password_hash, verify_password

from ..tokens.schemas import Token
from ..users.crud import (
    create_user_by_phone_number,
    get_or_create_user_by_phone_number,
    get_user_by_phone_number,
)
from .jwt import get_jwt_strategy
from .otp_storage import (
    OtpVerifyResult,
    can_request_new_code,
    mark_phone_verify_lockout,
    phone_verify_locked_out,
    store_otp,
    verify_otp,
)
from .refresh_sessions import issue_refresh_token
from .schemas import (
    OTPResponse,
    PasswordRequest,
    PasswordSetRequest,
    PasswordSetResponse,
    PasswordStatusRequest,
    PasswordStatusResponse,
    RequestOTPRequest,
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
    client_ip = request.client.host if request.client is not None else "unknown"
    await enforce_limit(
        scope=scope,
        value=client_ip,
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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверное имя пользователя или пароль",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = await get_jwt_strategy().write_token(user)
    return Token(
        access_token=access_token,
        token_type="bearer",
        refresh_token=await issue_refresh_token(session, user_id=user.id),
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

    otp_code = generate_otp_code()
    await store_otp(
        session,
        phone_number=phone_number,
        code=otp_code,
        ttl_seconds=settings.auth_otp_expire_seconds,
    )
    enqueue_sms_otp(phone_number, otp_code)

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
    access_token = await get_jwt_strategy().write_token(user)
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        refresh_token=await issue_refresh_token(session, user_id=user.id),
    )


# --- Вход по паролю (временная замена OTP/SMS) ---------------------------
# Пока SMS/Telegram-доставка недоступна (нет платного шлюза), вход — по номеру
# телефона и паролю. Если у номера ещё нет заданного пароля (password_set=False),
# предлагаем его создать. OTP-эндпоинты ниже остаются в коде для будущего.

_PASSWORD_MIN_LENGTH = 6
_PASSWORD_MAX_LENGTH = 128


def _validate_new_password(password: str) -> str:
    """Проверяет длину нового пароля и возвращает его (или HTTP 400)."""
    if not (_PASSWORD_MIN_LENGTH <= len(password) <= _PASSWORD_MAX_LENGTH):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Пароль должен быть длиной от {_PASSWORD_MIN_LENGTH} "
                f"до {_PASSWORD_MAX_LENGTH} символов."
            ),
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
    if user is None:
        return PasswordStatusResponse(
            registered=False,
            has_password=False,
            otp_available=otp_delivery_available(None),
        )
    return PasswordStatusResponse(
        registered=True,
        has_password=user.password_set,
        otp_available=otp_delivery_available(user),
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
    password = _validate_new_password(request_data.password)

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
        await session.commit()

    access_token = await get_jwt_strategy().write_token(user)
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        refresh_token=await issue_refresh_token(session, user_id=user.id),
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

    user = await authenticate_user(phone_number, request_data.password, session)
    if user is None or not user.password_set:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный номер или пароль.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = await get_jwt_strategy().write_token(user)
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        refresh_token=await issue_refresh_token(session, user_id=user.id),
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
    """
    await _enforce_ip_limit(request, scope="auth:password-set", limit=10)
    password = _validate_new_password(request_data.password)

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
    await session.commit()
    logger.info("Пароль задан пользователем %s", user.id)
    return PasswordSetResponse(detail="Пароль сохранён.")


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
