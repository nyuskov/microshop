"""Запись и чтение журнала безопасности аккаунта.

События пишутся из «горячих» точек аутентификации (вход, коды, смена пароля,
отзыв сессий, смена e-mail). Владелец видит их в профиле: «Безопасность» →
«Последние действия» — это ответ на вопрос «что происходило с моим аккаунтом».

ВАЖНО: журнал не должен ломать основной сценарий. Если запись события почему-то
не удалась (например, БД под нагрузкой отдала ошибку), вход/смена пароля всё
равно должны выполниться — поэтому ``log_security_event`` гасит ошибки и пишет их
в лог приложения. Обратная ситуация («нет записи, но действие выполнено») менее
опасна, чем «не могу войти, потому что журнал не пишется».
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import Request
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import SecurityEvent

from .device import device_info

logger = logging.getLogger(__name__)

# Человекочитаемые подписи событий (используются и на фронте для списка).
EVENT_TITLES: dict[str, str] = {
    "login_success": "Вход в аккаунт",
    "login_failed": "Неудачная попытка входа",
    "login_locked": "Вход временно заблокирован (перебор пароля)",
    "otp_requested": "Запрошен код на телефон",
    "email_code_requested": "Запрошен код на e-mail",
    "device_challenge": "Новое устройство: запрошен код подтверждения",
    "device_verified": "Вход подтверждён кодом из письма",
    "device_unverified": "Вход с нового устройства (подтвердить нечем)",
    "password_changed": "Пароль изменён",
    "password_reset": "Пароль восстановлен по e-mail",
    "email_changed": "Адрес e-mail изменён",
    "email_verified": "Адрес e-mail подтверждён",
    "sessions_revoked": "Выход на всех устройствах",
    "session_revoked": "Завершён вход с устройства",
    "account_frozen": "Аккаунт заморожен",
    "account_unfrozen": "Аккаунт разморожен",
    "panic": "Тревога «это были не я»",
    "admin_sessions_revoked": "Поддержка завершила все входы",
    "admin_frozen": "Аккаунт заморожен поддержкой",
    "admin_unfrozen": "Аккаунт разморожен поддержкой",
    "account_deleted": "Аккаунт удалён",
    "e2ee_key_changed": "Сменён ключ шифрования устройства",
}

# Сколько дней хранить журнал: с запасом больше срока жизни refresh-токена,
# чтобы разобрать инцидент можно было и через месяц.
RETENTION_DAYS = 180

# Максимум записей, которые отдаём владельцу одним запросом.
MAX_LOG_ROWS = 200


async def log_security_event(
    session: AsyncSession,
    *,
    event: str,
    user_id: int | None,
    request: Request | None = None,
    detail: str = "",
    commit: bool = True,
) -> None:
    """Записывает событие безопасности (ошибки записи не ломают сценарий).

    ``commit=False`` нужен там, где вызывающий код сам управляет транзакцией
    (например, пишет событие вместе с изменением пароля).
    """
    try:
        info = device_info(request)
        session.add(
            SecurityEvent(
                user_id=user_id,
                event=event,
                ip=info.ip,
                device_signature=info.signature,
                device_user_agent=info.user_agent,
                detail=detail[:1000],
            )
        )
        if commit:
            await session.commit()
    except Exception:  # noqa: BLE001 - журнал не должен ломать вход/смену пароля
        logger.exception("Не удалось записать событие безопасности %s", event)


async def list_security_events(
    session: AsyncSession, *, user_id: int, limit: int = 50
) -> list[SecurityEvent]:
    """Последние события аккаунта (свежие сверху) для экрана «Безопасность»."""
    stmt = (
        select(SecurityEvent)
        .where(SecurityEvent.user_id == user_id)
        .order_by(SecurityEvent.created_at.desc(), SecurityEvent.id.desc())
        .limit(max(1, min(limit, MAX_LOG_ROWS)))
    )
    return list((await session.execute(stmt)).scalars().all())


async def prune_security_events(session: AsyncSession) -> int:
    """Удаляет записи журнала старше ``RETENTION_DAYS``. Возвращает их число."""
    threshold = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    result = await session.execute(
        delete(SecurityEvent).where(SecurityEvent.created_at < threshold)
    )
    await session.commit()
    return int(result.rowcount or 0)


__all__ = [
    "EVENT_TITLES",
    "MAX_LOG_ROWS",
    "RETENTION_DAYS",
    "list_security_events",
    "log_security_event",
    "prune_security_events",
]
