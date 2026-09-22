"""Регистрация по персональному приглашению (закрытый доступ «по инвайтам»).

Публичная регистрация выключена (``settings.registration_enabled``): новый
аккаунт можно создать только по одноразовой ссылке `/invite/<token>`, которую
владелец сервиса выдаёт лично. Ниже две части:

* ПУБЛИЧНАЯ — проверить ссылку и зарегистрироваться по ней. Работает независимо
  от ``REGISTRATION_ENABLED``: иначе выключенный рубильник заблокировал бы и
  сами приглашения.
* ВЛАДЕЛЬЦА ПРИГЛАШЕНИЙ (``is_superuser``) — список выданных ссылок, создание и
  отзыв. Раньше приглашения выдавал только CLI-скрипт
  (``scripts/create_invite.py``) и требовал ssh на сервер; эндпоинты повторяют
  ту же логику, чтобы ссылку можно было выдать с телефона.
"""

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.i18n import t
from core.models import RegistrationInvite, User, db_helper
from core.security import get_password_hash

from ...users.crud import create_user_by_phone_number, get_user_by_phone_number
from .. import audit
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
from ..utils import get_current_admin

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
    #: Галка согласия с документами сервиса. Необязательно: старые сборки
    #: приложения поле не присылают, и регистрация по ссылке не должна ломаться.
    #: При ``True`` сервер пишет об этом событие в журнал безопасности.
    accept_terms: bool = False


async def _get_invite(session: AsyncSession, token: str) -> RegistrationInvite | None:
    result = await session.execute(
        select(RegistrationInvite).where(RegistrationInvite.token == token)
    )
    return result.scalar_one_or_none()


def _invite_is_usable(invite: RegistrationInvite | None) -> bool:
    if invite is None or invite.used_at is not None or invite.revoked_at is not None:
        return False
    if invite.expires_at is not None:
        expires_at = invite.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            return False
    return True


def _as_utc(value: datetime) -> datetime:
    """Naive-дату из БД считаем UTC (сравнивать её с aware-временем нельзя)."""
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _as_utc_optional(value: datetime | None) -> datetime | None:
    return None if value is None else _as_utc(value)


class InviteItem(BaseModel):
    """Приглашение в списке владельца.

    Токен отдаём целиком: по нему собирается ссылка (в интерфейсе есть кнопка
    «скопировать»). Приглашение и так видит только владелец сервиса.
    """

    id: int
    token: str
    phone_number: str | None = None
    note: str | None = None
    created_at: datetime
    expires_at: datetime | None = None
    used_at: datetime | None = None
    revoked_at: datetime | None = None


class InviteListResponse(BaseModel):
    items: list[InviteItem]
    #: Сколько ссылок ещё действует (включая привязанные к номеру).
    active: int


class InviteCreateRequest(BaseModel):
    """Создание приглашения владельцем (как в scripts/create_invite.py)."""

    phone_number: str | None = None
    note: str | None = None
    #: Срок действия в днях; ``None`` — бессрочно.
    expires_days: int | None = None


@router.get("/invites/", response_model=InviteListResponse)
async def list_invites(
    admin: Annotated[User, Depends(get_current_admin)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> InviteListResponse:
    """Список приглашений (только владелец): свежие сверху.

    Отдаём и использованные с отозванными: по ним видно, кто зарегистрировался
    и какие ссылки больше не работают.
    """
    del admin  # нужен только для проверки прав
    result = await session.execute(
        select(RegistrationInvite).order_by(RegistrationInvite.id.desc()).limit(200)
    )
    invites = list(result.scalars().all())
    items = [
        InviteItem(
            id=invite.id,
            token=invite.token,
            phone_number=invite.phone_number,
            note=invite.note,
            created_at=_as_utc(invite.created_at),
            expires_at=_as_utc_optional(invite.expires_at),
            used_at=_as_utc_optional(invite.used_at),
            revoked_at=_as_utc_optional(invite.revoked_at),
        )
        for invite in invites
    ]
    return InviteListResponse(
        items=items,
        active=sum(1 for invite in invites if _invite_is_usable(invite)),
    )


@router.post(
    "/invites/", response_model=InviteItem, status_code=status.HTTP_201_CREATED
)
async def create_invite(
    request_data: InviteCreateRequest,
    admin: Annotated[User, Depends(get_current_admin)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> InviteItem:
    """Создаёт одноразовую ссылку-приглашение (только владелец).

    Та же логика, что в CLI-скрипте ``scripts/create_invite.py``, только из
    интерфейса: приложение работает без публичной регистрации, и владельцу
    удобнее выдавать ссылки с телефона, чем заходить на сервер по ssh.
    """
    phone_number = (request_data.phone_number or "").strip() or None
    if phone_number is not None and not validate_phone_number_format(phone_number):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Неверный формат номера телефона."),
        )
    if request_data.expires_days is not None and request_data.expires_days <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Срок действия должен быть больше нуля дней."),
        )

    expires_at = None
    if request_data.expires_days is not None:
        expires_at = datetime.now(timezone.utc) + timedelta(
            days=request_data.expires_days
        )

    note = (request_data.note or "").strip()[:200] or None
    invite = RegistrationInvite(
        token=secrets.token_urlsafe(32),
        phone_number=phone_number,
        note=note,
        expires_at=expires_at,
    )
    session.add(invite)
    await session.commit()
    await session.refresh(invite)

    logger.info(
        "Владелец %s создал приглашение %s (номер: %s)",
        admin.id,
        invite.id,
        phone_number or "любой",
    )
    return InviteItem(
        id=invite.id,
        token=invite.token,
        phone_number=invite.phone_number,
        note=invite.note,
        created_at=_as_utc(invite.created_at),
        expires_at=_as_utc_optional(invite.expires_at),
    )


@router.delete("/invites/{invite_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(
    invite_id: int,
    admin: Annotated[User, Depends(get_current_admin)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> None:
    """Погашает ссылку, не дожидаясь, пока ей воспользуются (только владелец).

    Помечаем ``revoked_at``, а не удаляем: в списке видно, что ссылка была и
    почему больше не работает. Повторный отзыв и отзыв уже использованной
    ссылки — 400: состояние меняет только первый.
    """
    invite = await session.get(RegistrationInvite, invite_id)
    if invite is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=t("Приглашение не найдено."),
        )
    if invite.used_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("По этой ссылке уже зарегистрировались — отзывать нечего."),
        )
    if invite.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Ссылка уже отозвана."),
        )

    invite.revoked_at = datetime.now(timezone.utc)
    await session.commit()
    logger.info("Владелец %s отозвал приглашение %s", admin.id, invite.id)


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
            detail=t("Ссылка-приглашение недействительна или уже использована."),
        )
    assert invite is not None  # для типизации: проверено в _invite_is_usable

    phone_number = request_data.phone_number
    if not validate_phone_number_format(phone_number):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Неверный формат номера телефона."),
        )
    if invite.phone_number and invite.phone_number != phone_number:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=t("Это приглашение выдано для другого номера телефона."),
        )

    existing = await get_user_by_phone_number(session, phone_number)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Для этого номера уже есть аккаунт. Войдите обычным способом."),
        )

    password = _validate_new_password(request_data.password, phone_number=phone_number)
    hashed = get_password_hash(password)
    user = await create_user_by_phone_number(session, phone_number, hashed)

    invite.used_at = datetime.now(timezone.utc)
    invite.used_by_user_id = user.id
    await session.commit()

    # Регистрация: отметил согласие с документами сервиса — фиксируем в журнале
    # безопасности (подтверждение согласия на обработку персональных данных).
    if request_data.accept_terms:
        await audit.log_security_event(
            session,
            event="terms_accepted",
            user_id=user.id,
            request=request,
            detail=audit.TERMS_DETAIL,
        )

    await _require_device_verification(session, request, user)
    access_token = await get_jwt_strategy().write_token(user)
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        refresh_token=await issue_refresh_token(
            session, user_id=user.id, device=device_info(request)
        ),
    )
