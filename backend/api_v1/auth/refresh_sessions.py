"""Сервис refresh-сессий: выпуск, ротация и отзыв refresh-токенов.

Сессия — это один вход (одно устройство). В профиле пользователь видит их
списком («Безопасность» → активные входы) и может отозвать любой по отдельности
или все сразу. Сведения об устройстве (sha256 от User-Agent, сам User-Agent, IP)
хранятся в самой сессии — см. ``api_v1/auth/device.py``.
"""

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.models import RefreshSession, User

from .device import DeviceInfo
from .utils import REFRESH_TOKEN_TYPE, build_refresh_token, decode_jwt


def _hash_jti(jti: str) -> str:
    """SHA-256 от jti — в БД хранится только хеш."""
    return hashlib.sha256(jti.encode("utf-8")).hexdigest()


def _expires_at() -> datetime:
    return datetime.now(timezone.utc) + timedelta(
        days=settings.auth_jwt.refresh_token_expire_days
    )


def _new_session(
    *, user_id: int, jti: str, device: DeviceInfo | None
) -> RefreshSession:
    """Собирает запись сессии (без добавления в сессию SQLAlchemy)."""
    return RefreshSession(
        user_id=user_id,
        jti_hash=_hash_jti(jti),
        expires_at=_expires_at(),
        device_signature=device.signature if device is not None else "",
        device_user_agent=device.user_agent if device is not None else "",
        device_ip=device.ip if device is not None else "",
    )


async def issue_refresh_token(
    session: AsyncSession, *, user_id: int, device: DeviceInfo | None = None
) -> str:
    """Создаёт refresh-сессию и возвращает refresh-токен (с claim jti).

    ``device`` — сведения об устройстве входа: по ним собирается список активных
    сессий в профиле и определяется «текущий» вход.
    """
    jti = uuid.uuid4().hex
    session.add(_new_session(user_id=user_id, jti=jti, device=device))
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
    stmt = select(RefreshSession).where(RefreshSession.jti_hash == _hash_jti(jti))
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None or row.user_id != user_id:
        return None
    if row.expires_at <= now:
        return None
    if row.revoked_at is not None:
        # «Сгоревший» токен используется повторно — вероятная кража.
        await revoke_all_sessions(session, user_id=user_id)
        return None

    # Ротация: гасим текущую сессию и выпускаем новую с тем же устройством.
    row.revoked_at = now
    new_jti = uuid.uuid4().hex
    row.replaced_by = _hash_jti(new_jti)
    session.add(
        _new_session(
            user_id=user_id,
            jti=new_jti,
            device=DeviceInfo(
                signature=row.device_signature,
                user_agent=row.device_user_agent,
                ip=row.device_ip,
            ),
        )
    )
    await session.commit()
    return build_refresh_token(user_id, new_jti)


async def bump_token_epoch(session: AsyncSession, *, user_id: int) -> None:
    """Поднимает «эпоху» доступа: все выданные ранее access-токены гаснут.

    Единственный способ отозвать уже выданный access-токен (он stateless и живёт
    30 минут). Номер эпохи вшит в токен, а здесь увеличивается — токены с прежней
    эпохой перестают приниматься (см. ``utils.access_token_problem``).
    """
    user = await session.get(User, user_id)
    if user is None:
        return
    user.token_epoch = int(user.token_epoch or 0) + 1
    await session.commit()


async def revoke_all_sessions(
    session: AsyncSession,
    *,
    user_id: int,
    keep_jti_hash: str | None = None,
    bump_epoch: bool = True,
) -> None:
    """Отзывает все активные refresh-сессии пользователя.

    ``keep_jti_hash`` — хеш jti сессии, которую НЕ трогаем: так «выйти на всех
    устройствах» оставляет владельца в приложении на текущем устройстве.

    ``bump_epoch`` — вместе с refresh-сессиями погасить и выданные access-токены
    (мгновенный отзыв доступа). Выключен только для технических вызовов, где
    токены гасить нельзя.
    """
    stmt = update(RefreshSession).where(
        RefreshSession.user_id == user_id,
        RefreshSession.revoked_at.is_(None),
    )
    if keep_jti_hash is not None:
        stmt = stmt.where(RefreshSession.jti_hash != keep_jti_hash)
    await session.execute(stmt.values(revoked_at=datetime.now(timezone.utc)))
    await session.commit()
    if bump_epoch:
        await bump_token_epoch(session, user_id=user_id)


async def revoke_all_except(
    session: AsyncSession, *, user_id: int, refresh_token: str | None
) -> None:
    """«Выйти на всех устройствах», не выкидывая текущее (если оно передано)."""
    keep = jti_hash_of(refresh_token) if refresh_token else None
    await revoke_all_sessions(session, user_id=user_id, keep_jti_hash=keep)


async def revoke_by_refresh_token(
    session: AsyncSession, *, refresh_token: str
) -> int | None:
    """Гасит сессию по её refresh-токену и возвращает id владельца (для аудита).

    Основа серверного logout: клиент шлёт свой refresh-токен, сервер отзывает
    именно эту сессию. Без этого украденный refresh оставался бы валидным все 30
    дней, даже если владелец «вышел» из приложения.
    """
    jti = jti_of(refresh_token)
    if jti is None:
        return None
    now = datetime.now(timezone.utc)
    stmt = select(RefreshSession).where(RefreshSession.jti_hash == _hash_jti(jti))
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None or row.revoked_at is not None:
        return None
    row.revoked_at = now
    await session.commit()
    return row.user_id


def jti_of(refresh_token: str) -> str | None:
    """jti из refresh-токена (``None`` — это не паш refresh-токен)."""
    try:
        payload = decode_jwt(refresh_token)
    except jwt.InvalidTokenError:
        return None
    if payload.get("type") != REFRESH_TOKEN_TYPE:
        return None
    jti = payload.get("jti")
    return jti if isinstance(jti, str) and jti else None


def jti_hash_of(refresh_token: str) -> str | None:
    """Хеш jti (в таком виде сессии лежат в БД)."""
    jti = jti_of(refresh_token)
    return _hash_jti(jti) if jti else None


async def list_active_sessions(
    session: AsyncSession, *, user_id: int
) -> list[RefreshSession]:
    """Активные сессии пользователя: свежие сверху (последний вход — первый)."""
    now = datetime.now(timezone.utc)
    stmt = (
        select(RefreshSession)
        .where(
            RefreshSession.user_id == user_id,
            RefreshSession.revoked_at.is_(None),
            RefreshSession.expires_at > now,
        )
        .order_by(RefreshSession.created_at.desc())
    )
    return list((await session.execute(stmt)).scalars().all())


async def revoke_session(
    session: AsyncSession, *, user_id: int, session_id: int
) -> bool:
    """Отзывает одну сессию пользователя. ``False`` — сессии нет или она чужая."""
    row = await session.get(RefreshSession, session_id)
    if row is None or row.user_id != user_id or row.revoked_at is not None:
        return False
    row.revoked_at = datetime.now(timezone.utc)
    await session.commit()
    return True
