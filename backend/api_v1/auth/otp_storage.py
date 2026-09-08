"""Хранение OTP-кодов в БД с защитой от перебора и повторной рассылки.

Раньше коды держались в in-memory dict — они терялись при рестарте и не работали
при нескольких воркерах. Теперь код хранится в таблице ``otp_codes`` только в виде
хеша, вместе со счётчиком неудачных попыток и временем последней отправки.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from enum import Enum

from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.models import OtpCode


class OtpVerifyResult(str, Enum):
    """Исход проверки кода (чтобы эндпоинт вернул корректный HTTP-статус)."""

    OK = "ok"
    NOT_FOUND = "not_found"
    INVALID = "invalid"
    EXPIRED = "expired"
    TOO_MANY = "too_many"


# In-memory «замки» на номер после исчерпания попыток ввода кода (phone -> когда
# разблокируется). Хранятся в памяти процесса: как и IP rate limiter, это валидно
# для однопроцессного запуска. Нужно, чтобы после «сгорания» кода нельзя было
# сразу запросить новый и снова перебирать: перебор прерывается на N минут.
_verify_lockouts: dict[str, datetime] = {}


def mark_phone_verify_lockout(phone_number: str, *, duration_seconds: int) -> None:
    """Блокирует ввод кода для номера на ``duration_seconds`` секунд."""
    _verify_lockouts[phone_number] = _now() + timedelta(seconds=duration_seconds)
    # Держим словарь небольшим: вычищаем истёкшие замки при каждой пометке.
    if len(_verify_lockouts) > 1024:
        _prune_verify_lockouts()


def phone_verify_locked_out(phone_number: str) -> bool:
    """True, если для номера активна блокировка ввода кода (после перебора)."""
    until = _verify_lockouts.get(phone_number)
    if until is None:
        return False
    if until <= _now():
        _verify_lockouts.pop(phone_number, None)
        return False
    return True


def _prune_verify_lockouts() -> None:
    now = _now()
    expired = [p for p, until in _verify_lockouts.items() if until <= now]
    for phone in expired:
        _verify_lockouts.pop(phone, None)


def _hash_code(phone_number: str, code: str) -> str:
    """Хеширует код с «солью» из секрета приложения — сам код в БД не хранится."""
    payload = f"{phone_number}:{code}:{settings.auth_jwt.secret_key}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _load(session: AsyncSession, phone_number: str) -> OtpCode | None:
    return await session.get(OtpCode, phone_number)


async def can_request_new_code(
    session: AsyncSession,
    *,
    phone_number: str,
    cooldown_seconds: int,
) -> bool:
    """True, если на этот номер ещё можно отправить код (кулдаун не истёк)."""
    row = await _load(session, phone_number)
    if row is None:
        return True
    # Просроченный/исчерпанный код не блокирует повторный запрос.
    if row.expires_at < _now():
        return True
    age = (_now() - row.created_at).total_seconds()
    return age >= cooldown_seconds


async def store_otp(
    session: AsyncSession,
    *,
    phone_number: str,
    code: str,
    ttl_seconds: int,
) -> None:
    """Создаёт или обновляет код для номера, сбрасывая счётчик попыток."""
    now = _now()
    row = await _load(session, phone_number)
    if row is None:
        session.add(
            OtpCode(
                phone_number=phone_number,
                code_hash=_hash_code(phone_number, code),
                attempts=0,
                expires_at=now + timedelta(seconds=ttl_seconds),
                created_at=now,
            )
        )
    else:
        row.code_hash = _hash_code(phone_number, code)
        row.attempts = 0
        row.expires_at = now + timedelta(seconds=ttl_seconds)
        row.created_at = now
    await session.commit()


async def verify_otp(
    session: AsyncSession,
    *,
    phone_number: str,
    code: str,
    max_attempts: int,
) -> OtpVerifyResult:
    """Проверяет код, учитывая число попыток и срок действия."""
    row = await _load(session, phone_number)
    if row is None:
        return OtpVerifyResult.NOT_FOUND

    if row.expires_at < _now():
        await session.delete(row)
        await session.commit()
        return OtpVerifyResult.EXPIRED

    if row.attempts >= max_attempts:
        # Код «выгорел» — удаляем, чтобы нельзя было продолжать перебор.
        await session.delete(row)
        await session.commit()
        return OtpVerifyResult.TOO_MANY

    expected = _hash_code(phone_number, code)
    if secrets.compare_digest(row.code_hash, expected):
        await session.delete(row)
        await session.commit()
        return OtpVerifyResult.OK

    row.attempts += 1
    await session.commit()
    return OtpVerifyResult.INVALID
