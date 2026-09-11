"""Тревожная кнопка («это были не я»).

Сценарий: чужой вошёл в аккаунт. Владелец получает push о новом входе и может
одним действием выкинуть вора — не заходя в приложение и даже с устройства, где
нет действующей сессии: в уведомлении лежит короткоживущий подписанный
``panic``-токен, и service worker отправляет его сюда.

Что делает: отзывает все сессии, поднимает ``token_epoch`` (все выданные ранее
access-токены перестают работать), а если у аккаунта есть подтверждённый e-mail
(чем разморозить) — ещё и замораживает аккаунт до подтверждения владения почтой.

Токен одноразовый по смыслу: после первого использования ``token_epoch``
меняется, а в токене лежит эпоха, поэтому повторная отправка того же токена
отклоняется (см. ``decode_panic_token``).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.models import User

from . import audit
from .refresh_sessions import revoke_all_sessions
from .security_notifications import notify_security_event

logger = logging.getLogger(__name__)

# Отдельные aud/type: panic-токен нельзя использовать ни как access, ни как refresh.
PANIC_TOKEN_TYPE = "panic"
PANIC_TOKEN_AUDIENCE = "microshop:panic"


def build_panic_token(user: User) -> str:
    """Короткоживущий токен для кнопки «Это не я» в уведомлении."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "jti": uuid.uuid4().hex,
        "type": PANIC_TOKEN_TYPE,
        "aud": PANIC_TOKEN_AUDIENCE,
        "epoch": int(user.token_epoch or 0),
        "iat": now,
        "exp": now + timedelta(minutes=settings.auth_panic_token_expire_minutes),
    }
    return jwt.encode(
        payload,
        settings.auth_jwt.secret_key,
        algorithm=settings.auth_jwt.algorithm,
    )


def decode_panic_token(token: str) -> tuple[int, int] | None:
    """Возвращает ``(id пользователя, эпоха)`` или ``None`` (токен недействителен).

    ``epoch`` внутри токена — защита от повторного использования: после первой
    тревоги эпоха меняется, и старый токен перестаёт приниматься.
    """
    try:
        payload = jwt.decode(
            token,
            settings.auth_jwt.secret_key,
            algorithms=[settings.auth_jwt.algorithm],
            audience=PANIC_TOKEN_AUDIENCE,
        )
    except jwt.InvalidTokenError:
        return None
    if payload.get("type") != PANIC_TOKEN_TYPE:
        return None
    sub = str(payload.get("sub", ""))
    if not sub.isdigit():
        return None
    return int(sub), int(payload.get("epoch") or 0)


async def apply_panic(
    session: AsyncSession, *, user: User, request=None, source: str = "push"
) -> dict[str, object]:
    """Выкидывает все сессии и (если есть чем разморозить) замораживает аккаунт."""
    await revoke_all_sessions(session, user_id=user.id)

    frozen = False
    if user.email and user.email_verified:
        # Разморозить можно только кодом из письма — канал есть, значит морозим.
        user.is_active = False
        frozen = True
        await session.commit()

    await notify_security_event(
        session,
        user,
        event="panic",
        request=request,
        details=(
            "Все устройства вышли из аккаунта по тревоге «это были не я»"
            + ("; аккаунт заморожен до подтверждения почты" if frozen else "")
        ),
    )
    await audit.log_security_event(
        session,
        event="panic",
        user_id=user.id,
        request=request,
        detail=f"тревога ({source}): сессии отозваны"
        + (", аккаунт заморожен" if frozen else ""),
    )
    logger.warning(
        "Тревога «это не я» для пользователя %s (%s): сессии отозваны, заморозка=%s",
        user.id,
        source,
        frozen,
    )
    return {"revoked": True, "frozen": frozen}
