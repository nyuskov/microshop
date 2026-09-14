"""Регистрация по персональному приглашению (закрытый доступ «по инвайтам»).

Публичная регистрация выключена (``settings.registration_enabled``): новый
аккаунт можно создать только по одноразовой ссылке `/invite/<token>`, которую
владелец сервиса генерирует вручную через ``scripts/create_invite.py`` и
передаёт лично приглашённому человеку. Эти эндпоинты работают независимо от
``REGISTRATION_ENABLED`` — иначе выключенный рубильник заблокировал бы и сами
приглашения.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import RegistrationInvite, db_helper
from core.security import get_password_hash

from ...users.crud import create_user_by_phone_number, get_user_by_phone_number
from ..common import (
    _enforce_ip_limit,
    _require_device_verification,
    _validate_new_password,
    validate_phone_number_format,
)
from ..device import device_info
from ..jwt import get_jwt_strategy
from ..refresh_sessions import issue_refresh_token
from ..schemas import TokenResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Аутентификация — Приглашения"])


class InviteStatusResponse(BaseModel):
    """Публичный статус ссылки-приглашения (для экрана регистрации)."""

    valid: bool
    #: Заполнено, если приглашение привязано к конкретному номеру: тогда поле
    #: номера на фронте можно сделать нередактируемым.
    phone_number: str | None = None


class InviteRegisterRequest(BaseModel):
    phone_number: str
    password: str


async def _get_invite(session: AsyncSession, token: str) -> RegistrationInvite | None:
    result = await session.execute(
        select(RegistrationInvite).where(RegistrationInvite.token == token)
    )
    return result.scalar_one_or_none()


def _invite_is_usable(invite: RegistrationInvite | None) -> bool:
    if invite is None or invite.used_at is not None:
        return False
    if invite.expires_at is not None:
        expires_at = invite.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            return False
    return True


@router.get("/invites/{token}/", response_model=InviteStatusResponse)
async def invite_status(
    token: str,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> InviteStatusResponse:
    """Проверяет ссылку-приглашение (не тратит попытку, только читает)."""
    await _enforce_ip_limit(request, scope="auth:invite-status", limit=30)
    invite = await _get_invite(session, token)
    if not _invite_is_usable(invite):
        return InviteStatusResponse(valid=False)
    assert invite is not None  # для типизации: проверено в _invite_is_usable
    return InviteStatusResponse(valid=True, phone_number=invite.phone_number)


@router.post("/invites/{token}/register/", response_model=TokenResponse)
async def invite_register(
    token: str,
    request_data: InviteRegisterRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> TokenResponse:
    """Создаёт аккаунт по приглашению и сразу входит.

    Работает всегда, даже если публичная регистрация выключена: сама выдача
    приглашений — это и есть контроль доступа (их создаёт только владелец
    сервиса), а не обход рубильника.
    """
    await _enforce_ip_limit(request, scope="auth:invite-register", limit=10)

    invite = await _get_invite(session, token)
    if not _invite_is_usable(invite):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ссылка-приглашение недействительна или уже использована.",
        )
    assert invite is not None  # для типизации: проверено в _invite_is_usable

    phone_number = request_data.phone_number
    if not validate_phone_number_format(phone_number):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неверный формат номера телефона.",
        )
    if invite.phone_number and invite.phone_number != phone_number:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Это приглашение выдано для другого номера телефона.",
        )

    existing = await get_user_by_phone_number(session, phone_number)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Для этого номера уже есть аккаунт. Войдите обычным способом.",
        )

    password = _validate_new_password(request_data.password, phone_number=phone_number)
    hashed = get_password_hash(password)
    user = await create_user_by_phone_number(session, phone_number, hashed)

    invite.used_at = datetime.now(timezone.utc)
    invite.used_by_user_id = user.id
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
