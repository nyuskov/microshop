"""Эндпоинты подтверждения e-mail адреса и входа по коду из письма."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from core import mailer
from core.config import settings
from core.i18n import t
from core.models import User, db_helper

from ...users.crud import get_user_by_email
from .. import audit, email_codes, security_notifications, views
from ..common import (
    _consume_email_code,
    _enforce_ip_limit,
    _ensure_active,
    _issue_email_code,
    email_request_detail,
)
from ..device import device_info
from ..jwt import get_jwt_strategy
from ..login_guard import reset_failures
from ..refresh_sessions import issue_refresh_token
from ..schemas import (
    EmailAddressRequest,
    EmailCodeConfirmRequest,
    EmailLoginConfirmRequest,
    EmailLoginRequest,
    OTPResponse,
    TokenResponse,
)
from ..utils import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Аутентификация — E-mail"])


@router.post("/email/request-verification/", response_model=OTPResponse)
async def request_email_verification(
    request_data: EmailAddressRequest,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> OTPResponse:
    """Отправляет код на адрес, чтобы привязать и подтвердить его в аккаунте."""
    await _enforce_ip_limit(request, scope="auth:email-verification", limit=10)
    if not views.email_otp_available():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Отправка писем не настроена на сервере."),
        )

    address = email_codes.normalize_email(str(request_data.email))
    owner = await get_user_by_email(session, address)
    if owner is not None and owner.id != user.id and owner.email_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Этот e-mail уже привязан к другому аккаунту."),
        )

    await _issue_email_code(
        session,
        request,
        email=address,
        purpose="Подтверждение адреса e-mail в Pismo.",
        user_id=user.id,
    )
    return OTPResponse(
        detail=t("Код отправлен на {email}.", email=mailer.mask_email(address))
    )


@router.post("/email/confirm-verification/", response_model=OTPResponse)
async def confirm_email_verification(
    request_data: EmailCodeConfirmRequest,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> OTPResponse:
    """Подтверждает адрес кодом из письма и привязывает его к аккаунту."""
    address = email_codes.normalize_email(str(request_data.email))

    owner = await get_user_by_email(session, address)
    if owner is not None and owner.id != user.id and owner.email_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Этот e-mail уже привязан к другому аккаунту."),
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
        detail=t("адрес e-mail подтверждён кодом из письма"),
    )
    return OTPResponse(detail=t("Адрес подтверждён."))


@router.post("/email/login/request/", response_model=OTPResponse)
async def request_email_login(
    request_data: EmailLoginRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> OTPResponse:
    """Вход без пароля: код на подтверждённый e-mail аккаунта."""
    await _enforce_ip_limit(request, scope="auth:email-login", limit=10)
    if not views.email_otp_available():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Вход по e-mail не настроен на сервере."),
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

    return OTPResponse(detail=await email_request_detail(session, user))


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
            detail=t("Неверный или истёкший код из письма."),
        )
    _ensure_active(user)

    await _consume_email_code(session, request, email=address, code=request_data.code)
    await reset_failures(session, identifier=address)

    await audit.log_security_event(
        session,
        event="login_success",
        user_id=user.id,
        request=request,
        detail=t("вход по коду из письма"),
    )

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
