"""Подпись к гифке: комментарий к вложению, как в Телеграме.

Гифка создаётся фоновым воркером (эндпоинт отвечает 202), поэтому подпись должна
дойти до него двумя шагами: эндпоинт кладёт её в задачу, задача пишет её текстом
сообщения. Оба шага проверяем по отдельности — иначе подпись терялась бы молча, а
заметить это можно было бы только по отсутствию текста в ленте.
"""

from __future__ import annotations

import inspect
import os

import pytest

from tasks import media_tasks
from tests.test_messenger_api import _ApiCtx  # noqa: E402
from tests.test_messenger_api import api as api_fixture  # noqa: E402

#: Фикстура API-теста живёт в test_messenger_api — импортируем, чтобы не
#: дублировать настройку httpx/БД.
api = api_fixture

GIF_URL = "https://media.giphy.com/media/26tOZ42Mg6pbTUPHW/giphy.gif"

needs_db = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


@needs_db
async def test_gif_endpoint_passes_caption_to_worker(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Подпись не теряется по дороге: эндпоинт кладёт её в задачу воркера."""
    user = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(user)
    chat_id = (await api.private_chat(token, peer.id))["id"]

    captured: dict = {}

    class FakeTask:
        """Заглушка Celery-задачи: помним, с чем её позвали."""

        def delay(self, **kwargs) -> None:
            captured.update(kwargs)

    monkeypatch.setattr("api_v1.messages.views.get_task", lambda _name: FakeTask())

    response = await api.client.post(
        "/api/v1/messages/gif/",
        json={"chat_id": chat_id, "url": GIF_URL, "caption": "  смотри  "},
        headers=api.auth(token),
    )
    assert response.status_code == 202, response.text
    assert captured["chat_id"] == chat_id
    # Пробелы по краям убираем: подпись — обычный текст сообщения.
    assert captured["caption"] == "смотри"


@needs_db
async def test_gif_without_caption_still_accepted(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Старый клиент (без подписи) продолжает работать."""
    user = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(user)
    chat_id = (await api.private_chat(token, peer.id))["id"]

    captured: dict = {}

    class FakeTask:
        def delay(self, **kwargs) -> None:
            captured.update(kwargs)

    monkeypatch.setattr("api_v1.messages.views.get_task", lambda _name: FakeTask())

    response = await api.client.post(
        "/api/v1/messages/gif/",
        json={"chat_id": chat_id, "url": GIF_URL},
        headers=api.auth(token),
    )
    assert response.status_code == 202, response.text
    assert captured["caption"] == ""


def test_worker_task_accepts_caption() -> None:
    """Задача воркера принимает подпись.

    Отдельная проверка нужна потому, что несовпадение аргументов (эндпоинт
    передал, задача не принимает) ломает задачу уже в проде и молча: гифка
    просто не приходит.
    """
    for func in (
        media_tasks.download_gif_message,
        media_tasks._download_gif_message_async,
    ):
        assert "caption" in inspect.signature(func).parameters


@needs_db
async def test_worker_stores_caption_as_message_text(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Воркер пишет подпись текстом сообщения — её видно в ленте под гифкой."""
    user = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(user)
    chat_id = (await api.private_chat(token, peer.id))["id"]

    # Сеть и диск не трогаем: файл «скачивается» заглушкой, на диск не пишем.
    monkeypatch.setattr(
        media_tasks,
        "_download_bytes",
        lambda url, limit: b"GIF89a" + b"\x00" * 16,
    )
    monkeypatch.setattr(
        media_tasks,
        "store_media",
        lambda content, suffix, prefix="": "/media/gif_test_stub.gif",
    )

    async def no_notify(**kwargs) -> None:
        """Событие realtime в тесте не рассылаем: мост RabbitMQ не поднят."""

    monkeypatch.setattr(media_tasks, "publish_realtime_new_message", no_notify)

    await media_tasks._download_gif_message_async(
        chat_id=chat_id,
        user_id=user.id,
        url=GIF_URL,
        caption="подпись к гифке",
    )

    response = await api.client.get(
        f"/api/v1/messages/{chat_id}/", headers=api.auth(token)
    )
    assert response.status_code == 200, response.text
    gifs = [
        row
        for row in response.json()
        if row["file"] and row["file"]["mime"] == "image/gif"
    ]
    assert len(gifs) == 1, "ожидали одно сообщение с гифкой"
    assert gifs[0]["text"] == "подпись к гифке"
