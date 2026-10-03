"""Галерея медиа чата: серверный список вложений (нужен PostgreSQL).

Лента отдаёт историю страницами, поэтому галерея «Медиа/Файлы» из загруженной
истории показывала только последние ~100 сообщений. Эндпоинт
``GET /api/v1/messages/{chat_id}/media/`` отдаёт вложения чата напрямую: с
фильтром по типу (image/video/audio/file) и пагинацией в старые.

Проверяем: только вложения и нужный порядок, фильтр по типу, пагинацию
``before_id``, недоступность для постороннего и пустой список в зашифрованном
чате (там галерея строится из расшифрованной истории на клиенте).
"""

from __future__ import annotations

import os

import pytest

from tests.api_support import _ApiCtx  # noqa: E402
from tests.api_support import api as api_fixture  # noqa: E402

#: Фикстура API-теста живёт в tests/api_support.py — импортируем, чтобы не
#: дублировать настройку httpx/БД.
api = api_fixture

PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    b"\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
    b"\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)

needs_db = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


async def _upload(
    api: _ApiCtx, token: str, chat_id: int, filename: str, body: bytes, **extra
):
    response = await api.client.post(
        "/api/v1/messages/attachment/",
        params={"chat_id": chat_id, "filename": filename, **extra},
        content=body,
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _media(api: _ApiCtx, token: str, chat_id: int, **params) -> list[dict]:
    response = await api.client.get(
        f"/api/v1/messages/{chat_id}/media/", params=params, headers=api.auth(token)
    )
    assert response.status_code == 200, response.text
    return response.json()


@needs_db
async def test_media_list_returns_attachments_newest_first(api: _ApiCtx) -> None:
    """В галерею попадают только вложения, от новых к старым."""
    user = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(user)
    chat = await api.private_chat(token, peer.id)
    chat_id = chat["id"]

    await api.send(token, chat_id, "обычный текст — в галерею не попадает")
    photo = await _upload(api, token, chat_id, "photo.png", PNG)
    video = await _upload(api, token, chat_id, "clip.mp4", b"\x00" * 32)
    doc = await _upload(api, token, chat_id, "doc.txt", b"hello")

    items = await _media(api, token, chat_id)
    assert [item["id"] for item in items] == [doc["id"], video["id"], photo["id"]]
    kinds = {item["name"]: item["kind"] for item in items}
    assert kinds == {"photo.png": "image", "clip.mp4": "video", "doc.txt": "file"}
    assert items[-1]["url"].startswith("/media/")


@needs_db
async def test_media_list_filters_by_kind(api: _ApiCtx) -> None:
    """Вкладки галереи фильтруются сервером, а не клиентом."""
    user = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(user)
    chat_id = (await api.private_chat(token, peer.id))["id"]

    await _upload(api, token, chat_id, "photo.png", PNG)
    await _upload(api, token, chat_id, "clip.mp4", b"\x00" * 32)
    # Голосовое: расширение .webm то же, что у видео, тип определяет mime.
    await _upload(api, token, chat_id, "voice.webm", b"\x00" * 32, mime="audio/webm")

    images = await _media(api, token, chat_id, kind="image")
    assert [item["name"] for item in images] == ["photo.png"]

    videos = await _media(api, token, chat_id, kind="video")
    assert [item["name"] for item in videos] == ["clip.mp4"]

    audio = await _media(api, token, chat_id, kind="audio")
    assert [item["name"] for item in audio] == ["voice.webm"]

    # «Файлы» — всё, что не картинка/видео/аудио: сюда попадает документ.
    await _upload(api, token, chat_id, "doc.txt", b"hello")
    files = await _media(api, token, chat_id, kind="file")
    assert [item["name"] for item in files] == ["doc.txt"]


@needs_db
async def test_media_list_pagination(api: _ApiCtx) -> None:
    """Галерея листается в старые: before_id отдаёт следующую порцию."""
    user = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(user)
    chat_id = (await api.private_chat(token, peer.id))["id"]

    ids = []
    for index in range(5):
        uploaded = await _upload(api, token, chat_id, f"photo_{index}.png", PNG)
        ids.append(uploaded["id"])

    first = await _media(api, token, chat_id, limit=2)
    assert [item["id"] for item in first] == [ids[4], ids[3]]

    second = await _media(api, token, chat_id, limit=2, before_id=ids[3])
    assert [item["id"] for item in second] == [ids[2], ids[1]]

    third = await _media(api, token, chat_id, limit=2, before_id=ids[1])
    assert [item["id"] for item in third] == [ids[0]]


@needs_db
async def test_media_list_forbidden_for_outsider(api: _ApiCtx) -> None:
    """Посторонний не видит вложения чужого чата."""
    user = await api.make_user()
    peer = await api.make_user()
    outsider = await api.make_user()
    owner_token = await api.token_for(user)
    chat_id = (await api.private_chat(owner_token, peer.id))["id"]
    await _upload(api, owner_token, chat_id, "photo.png", PNG)

    response = await api.client.get(
        f"/api/v1/messages/{chat_id}/media/",
        headers=api.auth(await api.token_for(outsider)),
    )
    assert response.status_code == 403, response.text
    assert "не являетесь участником" in response.json()["detail"]


@needs_db
async def test_media_list_empty_for_e2ee_chat(api: _ApiCtx) -> None:
    """В зашифрованном чате серверный список пуст: содержимое не читается."""
    user = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(user)
    chat = await api.private_chat(token, peer.id)
    chat_id = chat["id"]
    await _upload(api, token, chat_id, "photo.png", PNG)

    response = await api.client.put(
        f"/api/v1/chats/{chat_id}/e2ee/",
        json={"enabled": True},
        headers=api.auth(token),
    )
    assert response.status_code == 200, response.text

    assert await _media(api, token, chat_id) == []
