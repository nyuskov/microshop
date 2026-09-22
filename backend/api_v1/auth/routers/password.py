"""Эндпоинты аутентификации по паролю и сброса пароля."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from core import passwords
from core.config import settings
from core.i18n import DEFAULT_LOCALE, locale_of_user, t
from core.models import User, db_helper
from core.rate_limit import client_ip
from core.security import get_password_hash, verify_password

from ...tokens.schemas import Token
from ...users.crud import (
    create_user_by_phone_number,
    get_user_by_email,
    get_user_by_phone_number,
)
from .. import audit, email_codes, security_notifications, views
from ..common import (
    _consume_email_code,
    _enforce_ip_limit,
    _ensure_active,
    _issue_email_code,
    _require_device_verification,
    _validate_new_password,
    email_request_detail,
    otp_delivery_available,
    validate_phone_number_format,
)
from ..device import device_info
from ..jwt import get_jwt_strategy
from ..login_guard import lockout_seconds, register_failure, reset_failures
from ..refresh_sessions import issue_refresh_token, revoke_all_sessions
from ..schemas import (
    EmailLoginRequest,
    OTPResponse,
    PasswordRegisterRequest,
    PasswordRequest,
    PasswordResetConfirmRequest,
    PasswordSetRequest,
    PasswordSetResponse,
    PasswordStatusRequest,
    PasswordStatusResponse,
    TokenResponse,
)
from ..utils import authenticate_user, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Аутентификация — Пароль"])


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
            detail=t(
                "неверные учётные данные (логин/номер: {login})",
                login=form_data.username[:40],
            ),
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=t("Неверное имя пользователя или пароль"),
            headers={"WWW-Authenticate": "Bearer"},
        )

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
            detail=t("Неверный формат номера телефона."),
        )
    user = await get_user_by_phone_number(session, phone_number)
    email_channel = views.email_otp_available()
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
    request_data: PasswordRegisterRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> TokenResponse:
    """Создаёт пароль для номера (и аккаунт, если его нет) и сразу входит."""
    await _enforce_ip_limit(request, scope="auth:password-register", limit=10)
    phone_number = request_data.phone_number
    if not validate_phone_number_format(phone_number):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Неверный формат номера телефона."),
        )
    password = _validate_new_password(request_data.password, phone_number=phone_number)

    user = await get_user_by_phone_number(session, phone_number)
    if user is not None and user.password_set:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("У этого номера уже есть пароль. Войдите с ним."),
        )

    if user is None and not settings.registration_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=t("Регистрация новых пользователей временно отключена."),
        )

    hashed = get_password_hash(password)
    if user is None:
        user = await create_user_by_phone_number(session, phone_number, hashed)
        # Регистрация нового аккаунта: если человек отметил согласие с
        # документами сервиса, оставляем это в журнале безопасности — так
        # согласие можно подтвердить задним числом.
        if request_data.accept_terms:
            await audit.log_security_event(
                session,
                event="terms_accepted",
                user_id=user.id,
                request=request,
                detail=audit.TERMS_DETAIL,
            )
    else:
        user.hashed_password = hashed
        user.password_set = True
        user.password_weak = False
        await session.commit()

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
            detail=t("Неверный формат номера телефона."),
        )

    locked_for = await lockout_seconds(session, identifier=phone_number)
    if locked_for > 0:
        # Язык берём у владельца номера: он ещё не авторизован, но аккаунт уже
        # привязан к номеру, и сообщение увидит именно он.
        locked_user = await get_user_by_phone_number(session, phone_number)
        lang = (
            await locale_of_user(session, locked_user.id)
            if locked_user is not None
            else DEFAULT_LOCALE
        )
        await audit.log_security_event(
            session,
            event="login_locked",
            user_id=None,
            request=request,
            detail=t("блокировка перебора активна ещё {seconds} с", seconds=locked_for),
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=t(
                "Слишком много неверных попыток входа. Повторите через {seconds} сек.",
                lang=lang,
                seconds=locked_for,
            ),
            headers={"Retry-After": str(locked_for)},
        )

    user = await authenticate_user(phone_number, request_data.password, session)
    if user is None or not user.password_set:
        await register_failure(session, identifier=phone_number)
        failed_owner = await get_user_by_phone_number(session, phone_number)
        await audit.log_security_event(
            session,
            event="login_failed",
            user_id=failed_owner.id if failed_owner is not None else None,
            request=request,
            detail=t("вход по паролю: неверный номер или пароль"),
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=t("Неверный номер или пароль."),
            headers={"WWW-Authenticate": "Bearer"},
        )

    await reset_failures(session, identifier=phone_number)
    _ensure_active(user)

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
        detail=t("вход по паролю"),
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
    """Задаёт (или меняет) пароль текущего пользователя."""
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
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=t("Текущий пароль указан неверно."),
            )

    user.hashed_password = get_password_hash(password)
    user.password_set = True
    user.password_weak = False
    await session.commit()

    await revoke_all_sessions(session, user_id=user.id)
    await security_notifications.notify_security_event(
        session,
        user,
        event="password_changed",
        request=request,
        details=t(
            "Пароль изменён, остальные устройства вышли из аккаунта.\n"
            "IP-адрес: {ip}",
            lang=await locale_of_user(session, user.id),
            ip=client_ip(request) or t("неизвестен"),
        ),
    )
    logger.info("Пользователь %s изменил пароль", user.id)
    await audit.log_security_event(
        session,
        event="password_changed",
        user_id=user.id,
        request=request,
        detail=t("пароль изменён, старые сессии отозваны"),
    )

    access_token = await get_jwt_strategy().write_token(user)
    new_refresh = await issue_refresh_token(
        session, user_id=user.id, device=device_info(request)
    )
    return PasswordSetResponse(
        detail=t("Пароль успешно сохранён."),
        access_token=access_token,
        refresh_token=new_refresh,
    )


@router.post("/password/reset/request/", response_model=OTPResponse)
async def request_password_reset(
    request_data: EmailLoginRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> OTPResponse:
    """Восстановление доступа: код на подтверждённый e-mail аккаунта."""
    await _enforce_ip_limit(request, scope="auth:password-reset", limit=10)
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
    if user is not None and user.email_verified:
        await _issue_email_code(
            session,
            request,
            email=address,
            purpose="Сброс пароля Pismo.",
            user_id=user.id,
        )

    return OTPResponse(detail=await email_request_detail(session, user))


@router.post("/password/reset/confirm/", response_model=TokenResponse)
async def confirm_password_reset(
    request_data: PasswordResetConfirmRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> TokenResponse:
    """Меняет пароль по коду из письма и сразу входит на этом устройстве."""
    address = email_codes.normalize_email(str(request_data.email))
    user = await get_user_by_email(session, address)
    if user is None or not user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=t("Неверный или истёкший код из письма."),
        )
    _ensure_active(user)

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
        details=t(
            "Пароль восстановлен по коду из письма, прежние сессии отозваны.\n"
            "IP-адрес: {ip}",
            lang=await locale_of_user(session, user.id),
            ip=client_ip(request) or t("неизвестен"),
        ),
    )
    logger.info("Пользователь %s восстановил пароль по e-mail", user.id)
    await audit.log_security_event(
        session,
        event="password_reset",
        user_id=user.id,
        request=request,
        detail=t("пароль восстановлен по коду из письма, старые сессии отозваны"),
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
