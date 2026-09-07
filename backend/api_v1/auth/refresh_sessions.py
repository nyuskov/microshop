"""Сервис refresh-сессий: выпуск, ротация и отзыв refresh-токенов."""

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.models import RefreshSession

from .utils import build_refresh_token


def _hash_jti(jti: str) -> str:
    """SHA-256 от jti — в БД хранится только хеш."""
    return hashlib.sha256(jti.encode("utf-8")).hexdigest()


def _expires_at() -> datetime:
    return datetime.now(timezone.utc) + timedelta(
        days=settings.auth_jwt.refresh_token_expire_days
    )


async def issue_refresh_token(session: AsyncSession, *, user_id: int) -> str:
    """Создаёт refresh-сессию и возвращает refresh-токен (с claim jti)."""
    jti = uuid.uuid4().hex
    session.add(
        RefreshSession(
            user_id=user_id,
            jti_hash=_hash_jti(jti),
            expires_at=_expires_at(),
        )
    )
    await session.commit()
    return build_refresh_token(user_id, jti)


async def rotate_refresh_token(
    session: AsyncSession, *, jti: str, user_id: int
) -> str | None:
    """Ротирует refresh-токен; возвращает новый либо ``None``.

    ``None`` означает: токен не выдавался, истёк или уже отозван. При повторном
    использовании отозванного токена отзываются ВСЕ сессии пользователя
    (семейный отзыв — признак кражи токена).
    """
    now = datetime.now(timezone.utc)
    stmt = select(RefreshSession).where(
        RefreshSession.jti_hash == _hash_jti(jti)
    )
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None or row.user_id != user_id:
        return None
    if row.expires_at <= now:
        return None
    if row.revoked_at is not None:
        # «Сгоревший» токен используется повторно — вероятная кража.
        await revoke_all_sessions(session, user_id=user_id)
        return None

    # Ротация: гасим текущую сессию и выпускаем новую.
    row.revoked_at = now
    new_jti = uuid.uuid4().hex
    row.replaced_by = _hash_jti(new_jti)
    session.add(
        RefreshSession(
            user_id=user_id,
            jti_hash=_hash_jti(new_jti),
            expires_at=_expires_at(),
        )
    )
    await session.commit()
    return build_refresh_token(user_id, new_jti)


async def revoke_all_sessions(session: AsyncSession, *, user_id: int) -> None:
    """Отзывает все активные refresh-сессии пользователя (например, при logout)."""
    await session.execute(
        update(RefreshSession)
        .where(
            RefreshSession.user_id == user_id,
            RefreshSession.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(timezone.utc))
    )
    await session.commit()
