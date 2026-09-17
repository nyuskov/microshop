"""Расписание celery beat: ненужные задачи в него не попадают.

Зачем тест: задача ``tasks.telegram.telegram_poll_updates`` бесполезна там, где
до ``api.telegram.org`` нет маршрута (на проде он закрыт) — она мгновенно
выходит, но beat каждые ``TELEGRAM_POLL_INTERVAL_SECONDS`` всё равно шлёт тик и
в логе воркера появляется строка «succeeded in 0.0001s: None». Расписание
собирается функцией от настроек, поэтому это проверяется без запуска Celery.
"""

from __future__ import annotations

from core.celery_app import build_beat_schedule
from core.config import settings

TELEGRAM_POLL = "telegram-poll-updates"

#: Задачи, которые нужны всегда (не зависят от настроек каналов доставки).
ALWAYS_SCHEDULED = (
    "cleanup-orphan-media-daily",
    "delete-expired-stories-hourly",
    "prune-call-signals",
    "prune-security-events-weekly",
)


def _config(**overrides: object):
    """Настройки с подменёнными полями (без чтения окружения заново)."""
    return settings.model_copy(update=overrides)


def test_static_tasks_are_always_scheduled() -> None:
    """Уборки и чистки есть в расписании в любом случае."""
    schedule = build_beat_schedule(_config(telegram_poll_enabled=False))
    for name in ALWAYS_SCHEDULED:
        assert name in schedule, name


def test_poll_scheduled_when_enabled_and_token_set() -> None:
    """Есть токен и опрос разрешён — задача на месте, с нужным интервалом."""
    schedule = build_beat_schedule(
        _config(
            telegram_poll_enabled=True,
            telegram_bot_token="123:abc",
            telegram_poll_interval_seconds=7,
        )
    )
    assert schedule[TELEGRAM_POLL]["task"] == "tasks.telegram.telegram_poll_updates"
    assert schedule[TELEGRAM_POLL]["schedule"].total_seconds() == 7


def test_poll_absent_when_disabled() -> None:
    """Опрос выключен — задача из расписания пропадает целиком."""
    schedule = build_beat_schedule(
        _config(telegram_poll_enabled=False, telegram_bot_token="123:abc")
    )
    assert TELEGRAM_POLL not in schedule


def test_poll_absent_without_token() -> None:
    """Токена нет — опрашивать нечего, расписание не растёт."""
    schedule = build_beat_schedule(
        _config(telegram_poll_enabled=True, telegram_bot_token=None)
    )
    assert TELEGRAM_POLL not in schedule


def test_real_settings_build_a_schedule() -> None:
    """Текущее окружение даёт рабочее расписание (дымовая проверка)."""
    schedule = build_beat_schedule(settings)
    assert "cleanup-orphan-media-daily" in schedule
