"""Сервис входа по паролю: временная блокировка после неудачных попыток.

Лимиты «на IP» обходятся сменой адреса, поэтому считаем неудачи на конкретный
идентификатор (номер телефона или логин). После ``auth_login_max_failures``
неудач вход блокируется: сначала на ``auth_login_lockout_seconds``, затем задержка
удваивается с каждой новой неудачей и упирается в ``auth_login_lockout_max_seconds``.
Успешный вход сбрасывает счётчик.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.models import PasswordLoginAttempt


def normalize_identifier(identifier: str) -> str:
    """Ключ учёта неудач: без лишних пробелов и без учёта регистра."""
    return identifier.strip().lower()


async def _load(session: AsyncSession, identifier: str) -> PasswordLoginAttempt | None:
    stmt = select(PasswordLoginAttempt).where(
        PasswordLoginAttempt.identifier == normalize_identifier(identifier)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def lockout_seconds(session: AsyncSession, *, identifier: str) -> int:
    """Сколько секунд осталось до разблокировки (0 — вход разрешён)."""
    row = await _load(session, identifier)
    if row is None or row.locked_until is None:
        return 0
    remaining = (row.locked_until - datetime.now(timezone.utc)).total_seconds()
    return max(0, int(remaining))


async def register_failure(session: AsyncSession, *, identifier: str) -> int:
    """Фиксирует неудачную попытку; возвращает новое число неудач.

    Начиная с порога ``auth_login_max_failures`` выставляет ``locked_until``:
    задержка растёт как ``base * 2**(превышение)`` с потолком ``max``.
    """
    now = datetime.now(timezone.utc)
    row = await _load(session, identifier)
    if row is None:
        row = PasswordLoginAttempt(
            identifier=normalize_identifier(identifier),
            failed_attempts=0,
        )
        session.add(row)

    row.failed_attempts += 1
    row.last_failed_at = now

    threshold = settings.auth_login_max_failures
    if row.failed_attempts >= threshold:
        over = row.failed_attempts - threshold
        delay = min(
            settings.auth_login_lockout_seconds * (2**over),
            settings.auth_login_lockout_max_seconds,
        )
        row.locked_until = now + timedelta(seconds=delay)
    else:
        row.locked_until = None

    await session.commit()
    return row.failed_attempts


async def reset_failures(session: AsyncSession, *, identifier: str) -> None:
    """Сбрасывает счётчик неудач (после успешного входа)."""
    await session.execute(
        delete(PasswordLoginAttempt).where(
            PasswordLoginAttempt.identifier == normalize_identifier(identifier)
        )
    )
    await session.commit()
