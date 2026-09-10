"""Хранилище кодов подтверждения по e-mail (аналог ``otp_storage`` для SMS).

Код не хранится в открытом виде: в БД лежит SHA-256 от ``email:code:secret``.
Здесь же — проверка попыток и срока действия, а также cooldown повторной отправки.
"""

import hashlib
from datetime import datetime, timedelta, timezone
from enum import Enum

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.models import EmailCode


class EmailVerifyResult(str, Enum):
    """Результат проверки кода из письма."""

    OK = "ok"
    INVALID = "invalid"
    EXPIRED = "expired"
    TOO_MANY = "too_many"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_email(email: str) -> str:
    """Ключ хранения: адрес без пробелов, в нижнем регистре."""
    return email.strip().lower()


def _hash_code(email: str, code: str) -> str:
    """Хеш кода с «солью» из секрета приложения."""
    payload = f"{normalize_email(email)}:{code}:{settings.auth_jwt.secret_key}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


async def _load(session: AsyncSession, email: str) -> EmailCode | None:
    stmt = select(EmailCode).where(EmailCode.email == normalize_email(email))
    return (await session.execute(stmt)).scalar_one_or_none()


async def can_request_email_code(
    session: AsyncSession, *, email: str, cooldown_seconds: int
) -> bool:
    """Прошёл ли cooldown с предыдущей отправки на этот адрес."""
    row = await _load(session, email)
    if row is None:
        return True
    return (_now() - row.created_at).total_seconds() >= cooldown_seconds


async def store_email_code(
    session: AsyncSession, *, email: str, code: str, ttl_seconds: int
) -> None:
    """Создаёт или обновляет код для адреса, сбрасывая счётчик попыток."""
    now = _now()
    row = await _load(session, email)
    if row is None:
        session.add(
            EmailCode(
                email=normalize_email(email),
                code_hash=_hash_code(email, code),
                attempts=0,
                expires_at=now + timedelta(seconds=ttl_seconds),
                created_at=now,
            )
        )
    else:
        row.code_hash = _hash_code(email, code)
        row.attempts = 0
        row.expires_at = now + timedelta(seconds=ttl_seconds)
        row.created_at = now
    await session.commit()


async def verify_email_code(
    session: AsyncSession, *, email: str, code: str, max_attempts: int
) -> EmailVerifyResult:
    """Проверяет код: срок действия, число попыток, совпадение."""
    row = await _load(session, email)
    if row is None:
        return EmailVerifyResult.INVALID

    now = _now()
    if row.expires_at <= now:
        await session.delete(row)
        await session.commit()
        return EmailVerifyResult.EXPIRED

    if row.attempts >= max_attempts:
        await session.delete(row)
        await session.commit()
        return EmailVerifyResult.TOO_MANY

    if row.code_hash != _hash_code(email, code):
        row.attempts += 1
        await session.commit()
        if row.attempts >= max_attempts:
            await session.delete(row)
            await session.commit()
            return EmailVerifyResult.TOO_MANY
        return EmailVerifyResult.INVALID

    # Код верный — одноразовый: удаляем.
    await session.delete(row)
    await session.commit()
    return EmailVerifyResult.OK
