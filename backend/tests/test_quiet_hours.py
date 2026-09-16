"""Тесты правил «тихих часов» (не беспокоить).

Чистые функции без БД и сети: решение зависит только от настроек получателя и
текущего времени, поэтому проверяются границы окна, переход через полночь,
разные часовые пояса и то, что звонки по умолчанию будят.

Зачем это вообще на сервере: push рисует система (SDK RuStore в Android, служба
push браузера в PWA), а не наша страница — при закрытом приложении клиент не
может решить «сейчас тихо» и просто не показывать уведомление.
"""

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from core import quiet_hours


def profile(**overrides: object) -> SimpleNamespace:
    """Профиль получателя с настройками по умолчанию (окно 23:00–08:00)."""
    values: dict[str, object] = {
        "quiet_hours_enabled": True,
        "quiet_hours_start": 23 * 60,
        "quiet_hours_end": 8 * 60,
        "quiet_hours_allow_calls": True,
        "quiet_hours_offset": 3 * 60,  # Москва
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def utc(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 9, 16, hour, minute, tzinfo=timezone.utc)


def test_local_minutes_uses_offset_and_wraps_day() -> None:
    """Местное время = UTC + сдвиг, с переходом через сутки."""
    assert quiet_hours.local_minutes(utc(20), 3 * 60) == 23 * 60
    # 23:00 UTC при сдвиге +3 — уже 02:00 следующих суток.
    assert quiet_hours.local_minutes(utc(23), 3 * 60) == 2 * 60
    # Отрицательный сдвиг (Нью-Йорк, UTC−4): 02:00 UTC = 22:00 предыдущего дня.
    assert quiet_hours.local_minutes(utc(2), -4 * 60) == 22 * 60


def test_local_minutes_treats_naive_time_as_utc() -> None:
    """Наивная метка из БД — это UTC, а не «время сервера»."""
    naive = datetime(2026, 9, 16, 23, 0)
    assert quiet_hours.local_minutes(naive, 0) == 23 * 60


@pytest.mark.parametrize(
    ("minutes", "expected"),
    [
        (22 * 60 + 59, False),  # до окна
        (23 * 60, True),  # начало окна включается
        (23 * 60 + 30, True),
        (4 * 60, True),  # глубокая ночь
        (7 * 60 + 59, True),
        (8 * 60, False),  # конец окна не включается
        (12 * 60, False),
    ],
)
def test_window_crosses_midnight(minutes: int, expected: bool) -> None:
    """Обычное окно 23:00–08:00 идёт через полночь."""
    assert quiet_hours.in_quiet_window(minutes, 23 * 60, 8 * 60) is expected


@pytest.mark.parametrize(
    ("minutes", "expected"),
    [(12 * 60, False), (13 * 60, True), (16 * 60 + 59, True), (17 * 60, False)],
)
def test_window_inside_one_day(minutes: int, expected: bool) -> None:
    """Окно может не пересекать полночь (например, «тихий час» после обеда)."""
    assert quiet_hours.in_quiet_window(minutes, 13 * 60, 17 * 60) is expected


def test_equal_bounds_mean_no_window() -> None:
    """00:00–00:00 — это не «круглосуточно», а случайно совпавшие границы."""
    for minutes in (0, 8 * 60, 23 * 60 + 59):
        assert quiet_hours.in_quiet_window(minutes, 0, 0) is False


def test_disabled_or_missing_profile_never_skips() -> None:
    """Выключенные тихие часы и отсутствующий профиль ничего не глушат."""
    assert quiet_hours.skips_push(profile(quiet_hours_enabled=False), utc(1)) is False
    assert quiet_hours.skips_push(None, utc(1)) is False


def test_message_push_is_skipped_at_night() -> None:
    """Ночью сообщения не будят (02:00 по Москве = 23:00 UTC)."""
    assert quiet_hours.skips_push(profile(), utc(23)) is True
    # 12:00 по Москве — тишины нет.
    assert quiet_hours.skips_push(profile(), utc(9)) is False


def test_calls_wake_by_default() -> None:
    """Звонок в тихие часы проходит: человека будят звонком, а не сообщением."""
    assert quiet_hours.skips_push(profile(), utc(23), is_call=True) is False


def test_calls_can_be_disabled_too() -> None:
    """Если человек запретил звонки в тихие часы — не будим и звонком."""
    quiet = profile(quiet_hours_allow_calls=False)
    assert quiet_hours.skips_push(quiet, utc(23), is_call=True) is True
    # Днём звонок проходит как обычно.
    assert quiet_hours.skips_push(quiet, utc(9), is_call=True) is False


def test_different_timezones_are_independent() -> None:
    """Один и тот же момент: у одного ночь, у другого — день."""
    moment = utc(1)
    moscow = profile(quiet_hours_offset=3 * 60)  # 04:00 — тихо
    new_york = profile(quiet_hours_offset=-4 * 60)  # 21:00 — ещё нет
    assert quiet_hours.skips_push(moscow, moment) is True
    assert quiet_hours.skips_push(new_york, moment) is False


def test_utc_now_is_aware_utc() -> None:
    """Точка вызова времени — всегда UTC с поясом (иначе сдвиг поедет)."""
    now = quiet_hours.utc_now()
    assert now.tzinfo is not None
    assert now.utcoffset() == timezone.utc.utcoffset(None)
