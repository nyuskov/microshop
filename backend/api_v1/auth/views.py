"""Эндпоинты аутентификации: токены и OTP."""

import logging
import re
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.rate_limit import enforce_limit, rate_limit_key, rate_limiter
from core.celery_app import get_task
from core.config import settings
from core.models import db_helper

from ..tokens.schemas import Token
from ..users.crud import get_or_create_user_by_phone_number
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
from .schemas import OTPResponse, RequestOTPRequest, TokenResponse, VerifyOTPRequest
from .utils import authenticate_user

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


def enqueue_sms_otp(phone_number: str, otp_code: str) -> None:
    """Кладёт доставку OTP-кода в очередь Celery (RabbitMQ).

    Раньше отправка выполнялась синхронно прямо в теле запроса, блокируя
    эндпоинт на время сетевого вызова к SMS-провайдеру. Теперь «тяжёлая»
    отправка уходит в фоновый воркер (см. tasks/otp_tasks.py), а эндпоинт сразу
    возвращает ответ.

    Код печатается в web-логе (привычное место для dev-входа — как было до
    переноса на Celery), а воркер дополнительно логирует его при фактической
    «отправке». Если брокер RabbitMQ недоступен (например, локальный запуск web
    без docker-стека) — вход не роняем: код уже виден в строке выше, а воркер
    просто не получит задачу.
    """
    logger.info("SMS-заглушка: OTP-код для %s -> %s", phone_number, otp_code)
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
