"""Режим технических работ: рубильник, который переключается на живом сервере.

Зачем: во время обновления, переезда или разбора инцидента сервис должен
показывать понятный экран «идут технические работы», а не сыпать ошибками и
полупустыми списками. Рубильник живёт в БД (``app_settings``), а не в ``.env``:
переключение не требует правки файла и перезапуска контейнеров, а состояние
переживает деплой и рестарт.

Кто и что видит:

* статус — публичный ``GET /api/v1/system/maintenance/`` (работает и во время
  самих техработ: по нему приложение понимает, что показывать);
* переключает — только администратор (``PUT``, см. ``api_v1/system/views.py``);
* во время техработ API отвечает ``503`` с ``detail.code = "maintenance"``, кроме
  проверок живости, эндпоинтов входа и запросов самого администратора — иначе
  владелец не смог бы ни войти, ни выключить режим, а мониторинг принимал бы
  техработы за упавший сервис (см. ``maintenance_guard`` в ``main.py``).

Почему кэш: режим проверяется на КАЖДОМ запросе к API, а лишний ``SELECT`` на
каждый запрос — лишняя нагрузка. Держим значение в памяти процесса
``CACHE_TTL_SECONDS`` секунд: цена переключения — до двух секунд задержки на
других процессах, зато обычный запрос в БД не ходит.

Почему при недоступной БД режим считается выключенным: техработы — осознанное
действие человека (а не следствие аварии). Если БД молчит, честнее показать
ошибку загрузки, чем изображать плановые работы и прятать от владельца
настоящую причину.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from core.models import AppSetting, db_helper

logger = logging.getLogger(__name__)

#: Ключ настройки в ``app_settings``.
MAINTENANCE_KEY = "maintenance"

#: Код в ``detail.code`` ответа 503: по нему фронтенд отличает техработы от аварии.
MAINTENANCE_CODE = "maintenance"

#: Что показываем, если администратор не задал свой текст.
DEFAULT_MESSAGE = "Скоро вернёмся."

#: Сколько секунд держим состояние в памяти процесса (см. докстринг модуля).
CACHE_TTL_SECONDS = 2.0


@dataclass(frozen=True)
class MaintenanceState:
    """Состояние рубильника: включён ли режим, что показывать и с какого времени."""

    enabled: bool = False
    message: str = DEFAULT_MESSAGE
    #: Когда режим переключили в текущее состояние (для «включён с …» в панели).
    since: datetime | None = None
    updated_by_user_id: int | None = None


#: Кэш «время чтения → состояние». ``None`` — читаем из БД.
_cache: tuple[float, MaintenanceState] | None = None


def _as_utc(value: datetime) -> datetime:
    """Naive-дату из БД считаем UTC (сравнивать её с aware-временем нельзя)."""
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _state_from_row(row: AppSetting | None) -> MaintenanceState:
    """Разбирает значение настройки; мусор в ней считаем выключенным режимом."""
    if row is None:
        return MaintenanceState()
    try:
        payload = json.loads(row.value)
    except (TypeError, ValueError):
        logger.warning(
            "Настройка %s не разбирается как JSON — режим считается выключенным",
            MAINTENANCE_KEY,
        )
        return MaintenanceState()
    if not isinstance(payload, dict):
        return MaintenanceState()

    message = payload.get("message")
    if not isinstance(message, str) or not message.strip():
        message = DEFAULT_MESSAGE

    since: datetime | None = None
    raw_since = payload.get("since")
    if isinstance(raw_since, str) and raw_since:
        try:
            since = _as_utc(datetime.fromisoformat(raw_since))
        except ValueError:
            since = None

    by = payload.get("by")
    return MaintenanceState(
        enabled=bool(payload.get("enabled")),
        message=message,
        since=since,
        updated_by_user_id=by if isinstance(by, int) else None,
    )


def _remember(state: MaintenanceState) -> None:
    """Кладёт состояние в кэш процесса."""
    global _cache
    _cache = (time.monotonic(), state)


def invalidate_cache() -> None:
    """Сбрасывает кэш (после переключения и в тестах)."""
    global _cache
    _cache = None


async def read_state(session: AsyncSession) -> MaintenanceState:
    """Читает состояние прямо из БД (без кэша)."""
    row = await session.get(AppSetting, MAINTENANCE_KEY)
    return _state_from_row(row)


async def write_state(
    session: AsyncSession,
    *,
    enabled: bool,
    message: str | None = None,
    user_id: int | None = None,
) -> MaintenanceState:
    """Переключает режим и запоминает, кто это сделал."""
    text = (message or "").strip() or DEFAULT_MESSAGE
    now = datetime.now(timezone.utc)
    payload = json.dumps(
        {"enabled": enabled, "message": text, "since": now.isoformat(), "by": user_id},
        ensure_ascii=False,
    )

    row = await session.get(AppSetting, MAINTENANCE_KEY)
    if row is None:
        session.add(
            AppSetting(key=MAINTENANCE_KEY, value=payload, updated_by_user_id=user_id)
        )
    else:
        row.value = payload
        row.updated_by_user_id = user_id
    await session.commit()

    state = MaintenanceState(
        enabled=enabled, message=text, since=now, updated_by_user_id=user_id
    )
    _remember(state)
    return state


async def current_state() -> MaintenanceState:
    """Состояние для проверки на запросах: кэш в памяти, при сбое БД — выключено."""
    cached = _cache
    if cached is not None and time.monotonic() - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    try:
        async with db_helper.session_factory() as session:
            state = await read_state(session)
    except Exception as exc:
        # Не кэшируем: как только БД вернётся, режим прочитается сразу.
        logger.warning("Не удалось прочитать режим технических работ: %s", exc)
        return MaintenanceState()

    _remember(state)
    return state
