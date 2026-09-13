"""Эндпоинты управления сессиями, логом безопасности, заморозкой и паникой."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from core import mailer
from core.models import User, db_helper
from core.rate_limit import client_ip
from core.security import verify_password

from ...users.crud import get_user_by_id
from .. import audit, security_notifications
from ..common import _enforce_ip_limit
from ..device import device_info
from ..jwt import get_jwt_strategy
from ..panic import apply_panic, decode_panic_token
from ..refresh_sessions import (
    jti_hash_of,
    jti_of,
    list_active_sessions,
    revoke_all_sessions,
    revoke_by_refresh_token,
    revoke_session,
    rotate_refresh_token,
)
from ..schemas import (
    AuthSessionSchema,
    AuthSessionsResponse,
    FreezeRequest,
    FreezeResponse,
    LogoutRequest,
    PanicRequest,
    PanicResponse,
    PasswordSetResponse,
    RevokeAllRequest,
    SecurityLogEntry,
    SecurityLogResponse,
    SessionRevokeResponse,
)
from ..security_notifications import notify_account_frozen
from ..utils import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Аутентификация — Сессии"])


@router.get("/sessions/", response_model=AuthSessionsResponse)
async def list_sessions(
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> AuthSessionsResponse:
    """Активные входы аккаунта: устройство, IP, когда выполнен вход."""
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
    """Журнал безопасности аккаунта: что происходило (входы, смены, отзывы)."""
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


@router.post("/sessions/revoke-all/", response_model=PasswordSetResponse)
async def revoke_sessions(
    request: Request,
    payload: RevokeAllRequest | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> PasswordSetResponse:
    """Выходит из аккаунта на всех устройствах, кроме текущего."""
    await _enforce_ip_limit(request, scope="auth:revoke-all", limit=10)
    own_token = payload.refresh_token if payload is not None else None
    own_jti = jti_of(own_token) if own_token else None
    await revoke_all_sessions(
        session,
        user_id=user.id,
        keep_jti_hash=jti_hash_of(own_token) if own_token else None,
    )
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

    if own_jti is not None:
        renewed = await rotate_refresh_token(session, jti=own_jti, user_id=user.id)
        if renewed is not None:
            return PasswordSetResponse(
                detail="Остальные устройства вышли из аккаунта.",
                access_token=await get_jwt_strategy().write_token(user),
                refresh_token=renewed,
            )
    return PasswordSetResponse(detail="Вы вышли на всех устройствах.")


@router.post("/logout/", status_code=204)
async def logout(
    request: Request,
    payload: LogoutRequest | None = None,
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Выход из аккаунта на этом устройстве: сессия гасится НА СЕРВЕРЕ."""
    await _enforce_ip_limit(request, scope="auth:logout", limit=30)
    if payload is not None and payload.refresh_token:
        user_id = await revoke_by_refresh_token(
            session, refresh_token=payload.refresh_token
        )
        if user_id is not None:
            await audit.log_security_event(
                session,
                event="session_revoked",
                user_id=user_id,
                request=request,
                detail="выход из приложения на этом устройстве",
            )


@router.post("/account/freeze/", response_model=FreezeResponse)
async def freeze_account(
    request: Request,
    payload: FreezeRequest | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> FreezeResponse:
    """Заморозка аккаунта: мгновенно выкинуть всех и закрыть входы."""
    address = security_notifications.notification_recipient(user)
    if address is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Сначала подтвердите e-mail в профиле: заморозить аккаунт можно "
                "только тогда, когда есть чем его разморозить."
            ),
        )
    if user.password_set:
        password = (payload.password if payload is not None else None) or ""
        if not verify_password(password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Неверный пароль.",
            )
    await _enforce_ip_limit(request, scope="auth:freeze", limit=10)

    user.is_active = False
    await session.commit()
    await revoke_all_sessions(session, user_id=user.id)

    await notify_account_frozen(session, user=user, request=request, source="self")
    return FreezeResponse(
        detail=(
            "Аккаунт заморожен: все устройства вышли, вход закрыт. "
            "Разморозить можно кодом из письма."
        ),
        frozen=True,
        recovery_hint=mailer.mask_email(address),
    )


@router.post("/security/panic/", response_model=PanicResponse)
async def security_panic(
    request_data: PanicRequest,
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> PanicResponse:
    """Тревога «это были не я» из push-уведомления."""
    await _enforce_ip_limit(request, scope="auth:panic", limit=10)
    decoded = decode_panic_token(request_data.token)
    if decoded is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "Ссылка тревоги недействительна. Откройте приложение и нажмите "
                "«Выйти на всех устройствах»."
            ),
        )
    user_id, token_epoch = decoded
    user = await get_user_by_id(session, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Ссылка тревоги недействительна.",
        )
    if token_epoch != int(user.token_epoch or 0):
        return PanicResponse(
            detail="Сессии уже завершены.",
            revoked=True,
            frozen=not user.is_active,
        )

    result = await apply_panic(session, user=user, request=request, source="push")
    frozen = bool(result["frozen"])
    return PanicResponse(
        detail=(
            "Все устройства вышли из аккаунта."
            + (" Аккаунт заморожен до подтверждения почты." if frozen else "")
        ),
        revoked=True,
        frozen=frozen,
    )
