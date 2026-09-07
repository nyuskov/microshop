"""Эндпоинты аутентификации: токены и OTP."""

import logging
import re
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.models import db_helper

from ..tokens.schemas import Token
from ..users.crud import get_or_create_user_by_phone_number
from .jwt import get_jwt_strategy
from .otp_storage import OtpVerifyResult, can_request_new_code, store_otp, verify_otp
from .schemas import OTPResponse, RequestOTPRequest, TokenResponse, VerifyOTPRequest
from .utils import authenticate_user, build_refresh_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Аутентификация"])

PHONE_PATTERN = re.compile(
    r"^\+7\s?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{2})[\s.-]?(\d{2})$"
)


def generate_otp_code() -> str:
    """Генерирует 6-значный числовой OTP-код."""
    return f"{secrets.randbelow(1_000_000):06d}"


def validate_phone_number_format(phone_number: str) -> bool:
    """Проверяет формат номера телефона."""
    return bool(PHONE_PATTERN.match(phone_number))


def send_sms_otp(phone_number: str, otp_code: str) -> None:
    """Заглушка отправки SMS. В проде — вызов API провайдера."""
    logger.info("SMS to %s: OTP code is %s", phone_number, otp_code)


@router.post("/token/", response_model=Token)
async def login_for_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> Token:
    """Авторизует пользователя и возвращает access-токен."""
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
        refresh_token=build_refresh_token(user.id),
    )


@router.post("/request-otp/", response_model=OTPResponse)
async def request_otp(
    request_data: RequestOTPRequest,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> OTPResponse:
    """Запрашивает OTP-код для номера телефона (с кулдауном повторной отправки)."""
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

    otp_code = generate_otp_code()
    await store_otp(
        session,
        phone_number=phone_number,
        code=otp_code,
        ttl_seconds=settings.auth_otp_expire_seconds,
    )
    send_sms_otp(phone_number, otp_code)

    return OTPResponse(detail="Код OTP отправлен.")


@router.post("/verify-otp/", response_model=TokenResponse)
async def verify_otp_endpoint(
    request_data: VerifyOTPRequest,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> TokenResponse:
    """Верифицирует OTP-код и выдаёт токен (с ограничением числа попыток)."""
    phone_number = request_data.phone_number
    result = await verify_otp(
        session,
        phone_number=phone_number,
        code=request_data.otp,
        max_attempts=settings.auth_otp_max_attempts,
    )
    if result is not OtpVerifyResult.OK:
        if result is OtpVerifyResult.TOO_MANY:
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
        refresh_token=build_refresh_token(user.id),
    )
