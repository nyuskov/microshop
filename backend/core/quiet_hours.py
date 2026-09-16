"""Тихие часы (не беспокоить): в какое время не слать push.

Зачем на сервере, а не в клиенте: push рисует система, а не наша страница —
в Android-приложении уведомление показывает SDK RuStore, в PWA — служба push
браузера. Проверка «сейчас тихо» на клиенте до отправки просто не выполняется
(приложение закрыто), поэтому решает сервер: он один знает и время, и настройку.

Границы окна хранятся в минутах от полуночи по МЕСТНОМУ времени получателя, а
сам пояс — сдвигом от UTC (``quiet_hours_offset``). Сдвиг присылает клиент при
сохранении настроек: у устройства он всегда актуален, и серверу не нужна база
часовых поясов (``zoneinfo`` есть не во всех образах).

Правила намеренно разделены на чистые функции: они не зависят от БД и времени
системы (``now`` передаётся аргументом) — так их проверяют тесты.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Protocol

#: Границы допустимых значений (минуты от полуночи и сдвиг от UTC).
MINUTES_IN_DAY = 24 * 60
MIN_OFFSET_MINUTES = -12 * 60  # UTC−12
MAX_OFFSET_MINUTES = 14 * 60  # UTC+14

#: Значения по умолчанию: окно 23:00–08:00, звонки разрешены.
DEFAULT_START = 23 * 60
DEFAULT_END = 8 * 60


class QuietHoursSettings(Protocol):
    """Минимум полей профиля, нужный для решения (в тестах — SimpleNamespace)."""

    quiet_hours_enabled: bool
    quiet_hours_start: int
    quiet_hours_end: int
    quiet_hours_allow_calls: bool
    quiet_hours_offset: int


def local_minutes(now_utc: datetime, offset_minutes: int) -> int:
    """Минуты от полуночи в местном времени получателя.

    ``now_utc`` может прийти наивным (БД отдаёт такие значения) — считаем его
    UTC, а не «время сервера»: сервер живёт в UTC, и подмешивать его пояс нельзя.
    """
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    local = now_utc.astimezone(timezone.utc) + timedelta(minutes=offset_minutes)
    return local.hour * 60 + local.minute


def in_quiet_window(minutes: int, start: int, end: int) -> bool:
    """Попадает ли местное время в окно тишины.

    Окно может идти через полночь (23:00–08:00 — обычный случай). Если границы
    совпали (00:00–00:00), окна нет: иначе получилось бы 24 часа тишины, а это
    не то, что человек имел в виду.
    """
    if start == end:
        return False
    if start < end:
        return start <= minutes < end
    return minutes >= start or minutes < end


def skips_push(
    profile: QuietHoursSettings | None,
    now_utc: datetime,
    *,
    is_call: bool = False,
) -> bool:
    """Нужно ли пропустить push этому получателю.

    ``is_call`` — push о входящем звонке: если человек разрешил звонки в тихие
    часы, пропуска нет. Уведомления безопасности (вход с нового устройства,
    заморозка аккаунта) через эту проверку НЕ проходят намеренно: их глушить
    нельзя, для них отдельный канал уведомлений.
    """
    if profile is None or not profile.quiet_hours_enabled:
        return False
    if is_call and profile.quiet_hours_allow_calls:
        return False
    minutes = local_minutes(now_utc, profile.quiet_hours_offset)
    return in_quiet_window(minutes, profile.quiet_hours_start, profile.quiet_hours_end)


def utc_now() -> datetime:
    """Текущее время в UTC (одна точка для тестов и вызовов)."""
    return datetime.now(timezone.utc)
