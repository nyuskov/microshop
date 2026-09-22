"""Эндпоинты верификации устройства (2FA) и привязки Telegram-бота."""

import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.i18n import t
from core.models import TelegramBindLink, User, db_helper

from ...users.crud import get_user_by_id
from .. import audit, security_notifications
from ..common import _consume_email_code, _enforce_ip_limit
from ..device import device_info
from ..device_guard import DeviceChallengeError, decode_challenge
from ..jwt import get_jwt_strategy
from ..refresh_sessions import issue_refresh_token
from ..schemas import DeviceVerifyRequest, TokenResponse
from ..utils import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Аутентификация — Устройства и Telegram"])


@router.post("/login/verify-device/", response_model=TokenResponse)
async def verify_device_login(
    request_data: DeviceVerifyRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> TokenResponse:
    """Второй шаг входа с нового устройства: код из письма → токены."""
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
            detail=t("Подтверждение входа недействительно. Войдите заново."),
        ) from exc

    info = device_info(request)
    if signature != info.signature:
        logger.warning("Challenge устройства использован не с того устройства")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=t("Подтверждение входа недействительно. Войдите заново."),
        )

    user = await get_user_by_id(session, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=t("Подтверждение входа недействительно. Войдите заново."),
        )

    address = str(user.email or "")
    if not address:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=t("Подтверждение входа недействительно. Войдите заново."),
        )

    await _consume_email_code(session, request, email=address, code=request_data.code)
    await security_notifications.remember_login_device(
        session, user, request, notify=False
    )
    await audit.log_security_event(
        session,
        event="device_verified",
        user_id=user.id,
        request=request,
        detail=t("вход с нового устройства подтверждён кодом из письма"),
    )
    logger.info("Пользователь %s подтвердил вход с нового устройства", user.id)

    access_token = await get_jwt_strategy().write_token(user)
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        refresh_token=await issue_refresh_token(session, user_id=user.id, device=info),
    )


@router.post("/telegram/bind/")
async def create_telegram_bind_link(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, str | None]:
    """Создаёт ссылку привязки Telegram-чата к аккаунту."""
    now = datetime.now(timezone.utc)
    code = secrets.token_hex(12)
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
