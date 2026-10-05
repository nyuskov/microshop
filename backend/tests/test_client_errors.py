"""Отчёты о падении приложения: приём, лог, счётчик метрик и письмо владельцу.

Зачем эндпоинт: редкую ошибку интерфейса иначе не разобрать — браузер показывает
человеку экран «500», а на сервере её нет (запроса к серверу не было). Проверяем,
что отчёт оставляет след в логе и в счётчике метрик, что письмо с текстом ошибки
уходит, но НЕ превращается в поток при повторных отчётах, и что вход для отчёта
не обязателен (падать может и экран входа).

Запускается только при заданном TEST_DATABASE_URL (как остальные API-тесты).
"""

from __future__ import annotations

import logging
import os

import pytest

from api_v1.system import views as system_views
from core import metrics
from tests.api_support import _ApiCtx  # noqa: E402
from tests.api_support import api as api_fixture  # noqa: E402

#: Фикстура API-теста живёт в `tests/api_support.py` — импортируем, чтобы не
#: дублировать настройку httpx/БД.
api = api_fixture

pytestmark = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)

PATH = "/api/v1/system/client-error/"
LOGGER = "api_v1.system.views"


class _FakeTask:
    """Заглушка celery-задачи письма: пишем вызовы, в RabbitMQ не ходим."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []

    def delay(self, subject: str, recipient: str, body: str) -> None:
        self.calls.append((subject, recipient, body))


@pytest.fixture
def mailed(monkeypatch: pytest.MonkeyPatch) -> _FakeTask:
    """Подменяет задачу письма и снимает паузу между письмами (её-то и проверяем)."""
    task = _FakeTask()
    monkeypatch.setattr(system_views, "get_task", lambda _name: task)
    monkeypatch.setattr(system_views, "_last_error_mail_at", 0.0)
    return task


@pytest.fixture(autouse=True)
def _clean_metrics() -> None:
    """Счётчики живут на процесс — иначе тесты видели бы чужие отчёты."""
    metrics.reset_for_tests()
    yield
    metrics.reset_for_tests()


async def test_report_is_logged_counted_and_mailed(
    api: _ApiCtx, mailed: _FakeTask, caplog
) -> None:
    payload = {
        "message": "Cannot read properties of null (reading 'play')",
        "stack": "TypeError: …\n  at AudioMessage.vue:42",
        "page": "/",
        "build": "179c19a 2026-10-03",
    }
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        response = await api.client.post(PATH, json=payload)

    assert response.status_code == 204
    # Текст ошибки обязан быть в логе: письмо может не уйти (SMTP, очередь), а
    # лог остаётся последним местом, где её видно.
    assert "Ошибка на клиенте" in caplog.text
    assert payload["message"] in caplog.text
    assert payload["build"] in caplog.text

    assert 'pismo_client_errors_total{kind="fatal"} 1' in metrics.render()

    assert len(mailed.calls) == 1
    subject, recipient, body = mailed.calls[0]
    assert "упало" in subject
    # Адрес берётся из ALERT_EMAIL (у настройки есть значение по умолчанию).
    assert recipient
    assert payload["message"] in body
    assert payload["build"] in body
    assert "AudioMessage.vue" in body


async def test_authorized_report_carries_user_id(
    api: _ApiCtx, mailed: _FakeTask, caplog
) -> None:
    """С токеном видно, У КОГО упало: без этого отчёт анонимный."""
    user = await api.make_user()
    token = await api.token_for(user)

    with caplog.at_level(logging.WARNING, logger=LOGGER):
        response = await api.client.post(
            PATH, json={"message": "boom"}, headers=api.auth(token)
        )

    assert response.status_code == 204
    assert f"user={user.id}" in caplog.text


async def test_repeated_reports_do_not_flood_mail(
    api: _ApiCtx, mailed: _FakeTask
) -> None:
    """Одно падение с разных устройств — это один сигнал, а не поток писем."""
    for _ in range(3):
        response = await api.client.post(PATH, json={"message": "boom"})
        assert response.status_code == 204

    assert len(mailed.calls) == 1


async def test_empty_message_rejected(api: _ApiCtx, mailed: _FakeTask) -> None:
    """Пустой отчёт бесполезен: без текста ошибки разбирать нечего."""
    response = await api.client.post(PATH, json={"message": ""})

    assert response.status_code == 422
    assert mailed.calls == []


async def test_report_limit_is_enforced(api: _ApiCtx, mailed: _FakeTask) -> None:
    """Публичный эндпоинт закрыт лимитом: лишние отчёты получают 429."""
    limit = system_views.CLIENT_ERROR_LIMIT_PER_MINUTE
    codes = []
    for _ in range(limit + 1):
        response = await api.client.post(PATH, json={"message": "boom"})
        codes.append(response.status_code)

    assert codes.count(204) == limit
    assert codes[-1] == 429
