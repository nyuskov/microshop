"""Одноразовые медиа: «посмотреть один раз» (нужен PostgreSQL).

Вложение с флагом ``view_once`` сервер отдаёт ровно один раз: первый GET
возвращает файл и стирает блоб, дальше — «истёк». Проверяем именно это и
защиту от обходов: HEAD не должен расходовать просмотр (иначе браузер сжёг бы
вложение ещё до показа), пересылка и галерея «Медиа» тоже не должны давать
доступ к сожжённому, а стикер одноразовым быть не может.
"""

from __future__ import annotations

import os
import uuid

import pytest

from tests.api_support import _ApiCtx  # noqa: E402
from tests.api_support import api as api_fixture  # noqa: E402
from tests.test_group_invites import _group

api = api_fixture

needs_db = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)

#: Настоящая сигнатура PNG: открытые вложения проверяются по magic bytes.
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


async def _send_view_once(api: _ApiCtx, token: str, chat_id: int) -> dict:
    """Отправляет одноразовую картинку и возвращает сообщение."""
    response = await api.client.post(
        f"/api/v1/messages/attachment/?chat_id={chat_id}"
        f"&filename=sekret-{uuid.uuid4().hex[:6]}.png&view_once=true",
        content=PNG,
        headers={**api.auth(token), "Content-Type": "image/png"},
    )
    assert response.status_code == 200, response.text
    return response.json()


@needs_db
async def test_view_once_served_single_time(api: _ApiCtx) -> None:
    """Первый GET отдаёт файл, второй — «истёк», и в ленте видно, что открыли."""
    first = await api.make_user()
    second = await api.make_user()
    first_token = await api.token_for(first)
    chat = await api.private_chat(first_token, second.id)

    message = await _send_view_once(api, first_token, chat["id"])
    assert message["view_once"] is True
    assert message["view_once_opened"] is False
    url = message["file"]["url"]

    # HEAD не расходует просмотр: браузеры сами щупают файл перед загрузкой.
    head = await api.client.head(url)
    assert head.status_code == 200
    assert head.headers["content-length"] == str(len(PNG))

    seen = await api.client.get(url)
    assert seen.status_code == 200
    assert seen.content == PNG

    # Повторная выдача закрыта — и прямым запросом, и в самой ленте.
    again = await api.client.get(url)
    assert again.status_code == 410
    assert "просмотрено" in again.json()["detail"].lower()

    fresh = await api.list_messages(first_token, chat["id"])
    stored = next(item for item in fresh if item["id"] == message["id"])
    assert stored["view_once_opened"] is True


@needs_db
async def test_view_once_cannot_be_forwarded(api: _ApiCtx) -> None:
    """Пересылка одноразового вложения запрещена: иначе копия осталась бы навсегда."""
    author = await api.make_user()
    other = await api.make_user()
    author_token = await api.token_for(author)
    other_token = await api.token_for(other)
    chat = await api.private_chat(author_token, other.id)
    message = await _send_view_once(api, author_token, chat["id"])

    forwarded = await api.client.post(
        "/api/v1/messages/forward/",
        json={"message_id": message["id"], "chat_id": chat["id"]},
        headers=api.auth(other_token),
    )
    assert forwarded.status_code == 400
    assert "Одноразовое" in forwarded.json()["detail"]


@needs_db
async def test_view_once_hidden_from_media_gallery(api: _ApiCtx) -> None:
    """Галерея «Медиа» не показывает сгораемые вложения (превью сожгло бы их)."""
    author = await api.make_user()
    other = await api.make_user()
    author_token = await api.token_for(author)
    chat = await api.private_chat(author_token, other.id)
    message = await _send_view_once(api, author_token, chat["id"])

    gallery = await api.client.get(
        f"/api/v1/messages/{chat['id']}/media/", headers=api.auth(author_token)
    )
    assert gallery.status_code == 200, gallery.text
    assert all(item["id"] != message["id"] for item in gallery.json())


@needs_db
async def test_sticker_cannot_be_view_once(api: _ApiCtx) -> None:
    """Стикер не может быть одноразовым: он живёт в панели, а не в ленте."""
    author = await api.make_user()
    other = await api.make_user()
    author_token = await api.token_for(author)
    chat = await api.private_chat(author_token, other.id)

    response = await api.client.post(
        f"/api/v1/messages/attachment/?chat_id={chat['id']}&filename=s.png"
        "&sticker=true&view_once=true",
        content=PNG,
        headers={**api.auth(author_token), "Content-Type": "image/png"},
    )
    assert response.status_code == 400
    assert "Стикер" in response.json()["detail"]


@needs_db
async def test_regular_attachment_is_not_view_once(api: _ApiCtx) -> None:
    """Обычное вложение ведёт себя как раньше: сколько угодно скачиваний."""
    author = await api.make_user()
    other = await api.make_user()
    author_token = await api.token_for(author)
    chat = await api.private_chat(author_token, other.id)

    response = await api.client.post(
        f"/api/v1/messages/attachment/?chat_id={chat['id']}&filename=obych.png",
        content=PNG,
        headers={**api.auth(author_token), "Content-Type": "image/png"},
    )
    assert response.status_code == 200, response.text
    message = response.json()
    assert message["view_once"] is False

    url = message["file"]["url"]
    for _ in range(2):
        got = await api.client.get(url)
        assert got.status_code == 200
        assert got.content == PNG


@needs_db
async def test_view_once_in_group_media_upload(api: _ApiCtx) -> None:
    """В группе одноразовое вложение тоже сгорает после первого просмотра."""
    creator = await api.make_user()
    member = await api.make_user()
    creator_token = await api.token_for(creator)
    member_token = await api.token_for(member)
    chat = await _group(api, creator_token, [member.id])

    message = await _send_view_once(api, member_token, chat["id"])
    url = message["file"]["url"]

    # Смотрит создатель — вложение сгорает для всех: файла больше нет.
    assert (await api.client.get(url)).status_code == 200
    assert (await api.client.get(url)).status_code == 410
    assert (await api.client.get(url)).status_code == 410
