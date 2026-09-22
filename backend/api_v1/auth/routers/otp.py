"""Эндпоинты авторизации по OTP-коду (телефон) и разморозки аккаунта."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.i18n import t
from core.models import db_helper
from core.rate_limit import client_ip, enforce_limit, rate_limit_key, rate_limiter

from ...users.crud import (
    get_or_create_user_by_phone_number,
    get_user_by_email,
    get_user_by_phone_number,
)
from .. import audit, email_codes, security_notifications, views
from ..common import (
    _EMAIL_REQUEST_DETAIL,
    _consume_email_code,
    _enforce_ip_limit,
    _issue_email_code,
    _require_device_verification,
    generate_otp_code,
    otp_delivery_available,
    validate_phone_number_format,
)
from ..device import device_info
from ..jwt import get_jwt_strategy
from ..login_guard import reset_failures
from ..otp_storage import (
    OtpVerifyResult,
    can_request_new_code,
    mark_phone_verify_lockout,
    phone_verify_locked_out,
    store_otp,
    verify_otp,
)
from ..refresh_sessions import bump_token_epoch, issue_refresh_token
from ..schemas import (
    AuthChannelsResponse,
    EmailAddressRequest,
    EmailCodeConfirmRequest,
    OTPResponse,
    RequestOTPRequest,
    TokenResponse,
    VerifyOTPRequest,
)
from ..security_notifications import notify_account_unfrozen

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Аутентификация — OTP"])


@router.get("/channels/", response_model=AuthChannelsResponse)
async def auth_channels(request: Request) -> AuthChannelsResponse:
    """Публичный список доступных каналов доставки кодов (для экрана входа)."""
    await _enforce_ip_limit(request, scope="auth:channels", limit=60)
    return AuthChannelsResponse(
        otp_available=otp_delivery_available(None),
        email_otp_available=views.email_otp_available(),
        registration_enabled=settings.registration_enabled,
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
            detail=t("Неверный формат номера телефона. Ожидается +7 (___) ___-__-__."),
        )

    cooldown = settings.auth_otp_resend_cooldown_seconds
    if not await can_request_new_code(
        session, phone_number=phone_number, cooldown_seconds=cooldown
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=t(
                "Код уже отправлен. Повторите запрос через {seconds} секунд.",
                seconds=cooldown,
            ),
            headers={"Retry-After": str(cooldown)},
        )

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
    views.enqueue_sms_otp(phone_number, otp_code)
    otp_owner = await get_user_by_phone_number(session, phone_number)
    await audit.log_security_event(
        session,
        event="otp_requested",
        user_id=otp_owner.id if otp_owner is not None else None,
        request=request,
        detail=t("код подтверждения запрошен на номер аккаунта"),
    )

    return OTPResponse(detail=t("Код OTP отправлен."))


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
            mark_phone_verify_lockout(
                phone_number,
                duration_seconds=settings.auth_otp_verify_lockout_seconds,
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=t("Слишком много неверных попыток. Запросите новый код."),
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=t("Неверный или истёкший код OTP."),
        )

    existing_user = await get_user_by_phone_number(session, phone_number)
    if existing_user is None and not settings.registration_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=t("Регистрация новых пользователей временно отключена."),
        )

    user = existing_user or await get_or_create_user_by_phone_number(
        session, phone_number
    )
    # Новый номер = регистрация: подтверждение кода здесь же и создаёт аккаунт,
    # поэтому согласие с документами сервиса приходит в ЭТОМ запросе (см.
    # `consentRequired` на экране входа). Пишем в журнал безопасности, чтобы
    # согласие можно было подтвердить задним числом.
    if existing_user is None and request_data.accept_terms:
        await audit.log_security_event(
            session,
            event="terms_accepted",
            user_id=user.id,
            request=request,
            detail=audit.TERMS_DETAIL,
        )
    await _require_device_verification(session, request, user)
    await audit.log_security_event(
        session,
        event="login_success",
        user_id=user.id,
        request=request,
        detail=t("вход по коду на телефон"),
    )
    access_token = await get_jwt_strategy().write_token(user)
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        refresh_token=await issue_refresh_token(
            session, user_id=user.id, device=device_info(request)
        ),
    )


@router.post("/account/unfreeze/request/", response_model=OTPResponse)
async def request_account_unfreeze(
    request_data: EmailAddressRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> OTPResponse:
    """Код на подтверждённый e-mail для разморозки аккаунта."""
    await _enforce_ip_limit(request, scope="auth:unfreeze", limit=10)
    if not views.email_otp_available():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Восстановление по e-mail не настроено на сервере."),
        )
    address = email_codes.normalize_email(str(request_data.email))
    cooldown = settings.auth_email_resend_cooldown_seconds
    if not await email_codes.can_request_email_code(
        session, email=address, cooldown_seconds=cooldown
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=t(
                "Код уже отправлен. Повторите через {seconds} секунд.", seconds=cooldown
            ),
            headers={"Retry-After": str(cooldown)},
        )

    user = await get_user_by_email(session, address)
    if user is not None and user.email_verified and not user.is_active:
        await _issue_email_code(
            session,
            request,
            email=address,
            purpose="Разморозка аккаунта Pismo.",
            user_id=user.id,
        )
    return OTPResponse(detail=_EMAIL_REQUEST_DETAIL)


@router.post("/account/unfreeze/", response_model=TokenResponse)
async def confirm_account_unfreeze(
    request_data: EmailCodeConfirmRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> TokenResponse:
    """Разморозка аккаунта по коду из письма и вход на этом устройстве."""
    address = email_codes.normalize_email(str(request_data.email))
    user = await get_user_by_email(session, address)
    if user is None or not user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=t("Неверный или истёкший код из письма."),
        )
    await _consume_email_code(session, request, email=address, code=request_data.code)

    user.is_active = True
    await session.commit()
    await bump_token_epoch(session, user_id=user.id)
    await reset_failures(session, identifier=address)

    logger.warning("Пользователь %s разморозил аккаунт по коду из письма", user.id)
    await audit.log_security_event(
        session,
        event="account_unfrozen",
        user_id=user.id,
        request=request,
        detail=t("аккаунт разморожен по коду из письма"),
    )
    await security_notifications.remember_login_device(
        session, user, request, notify=False
    )
    await notify_account_unfrozen(session, user=user, request=request)
    return TokenResponse(
        access_token=await get_jwt_strategy().write_token(user),
        token_type="bearer",
        refresh_token=await issue_refresh_token(
            session, user_id=user.id, device=device_info(request)
        ),
    )
