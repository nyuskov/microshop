"""Альбомы: несколько картинок одной отправки (нужен PostgreSQL).

Пачка картинок уезжает на сервер отдельными сообщениями (тело запроса — байты
одного файла), но с общей меткой ``album_id``: по ней лента рисует их одной
сеткой.

Что проверяем:
- метка сохраняется и возвращается вместе с сообщением;
- лимит размера альбома и состав (только изображения, без стикеров и
  одноразовых вложений);
- Web Push планируется ОДИН раз на альбом: событий реального времени столько же,
  сколько файлов, а уведомление «Новое сообщение» — одно;
- лимит частоты загрузок считается на альбом, а не на каждый файл: иначе пачка
  из десяти фото упиралась бы в собственный лимит «10 загрузок в минуту».
"""

from __future__ import annotations

import os
import uuid

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


def _album_id() -> str:
    """Метка альбома — её придумывает клиент (40 символов UUID не превышаем)."""
    return str(uuid.uuid4())


async def _upload(
    api: _ApiCtx, token: str, chat_id: int, filename: str, body: bytes = PNG, **extra
):
    return await api.client.post(
        "/api/v1/messages/attachment/",
        params={"chat_id": chat_id, "filename": filename, **extra},
        content=body,
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )


@needs_db
async def test_album_parts_share_label_and_keep_order(api: _ApiCtx) -> None:
    """У всех картинок пачки одна метка, порядок — как отправляли."""
    user = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(user)
    chat_id = (await api.private_chat(token, peer.id))["id"]
    album_id = _album_id()

    ids = []
    for index in range(3):
        response = await _upload(
            api,
            token,
            chat_id,
            f"photo_{index}.png",
            album_id=album_id,
            mime="image/png",
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["album_id"] == album_id
        ids.append(payload["id"])

    response = await api.client.get(
        f"/api/v1/messages/{chat_id}/", headers=api.auth(token)
    )
    assert response.status_code == 200
    listed = [row for row in response.json() if row["album_id"] == album_id]
    assert [row["id"] for row in listed] == ids

    # Обычное вложение (без метки) остаётся одиночным — альбом не «прилипает».
    single = await _upload(api, token, chat_id, "one.png")
    assert single.json()["album_id"] is None


@needs_db
async def test_album_rejects_non_images_stickers_and_extra_parts(
    api: _ApiCtx,
) -> None:
    """Альбом — только картинки; стикеры, одноразовые и лишние части отклоняем."""
    user = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(user)
    chat_id = (await api.private_chat(token, peer.id))["id"]
    album_id = _album_id()

    ok = await _upload(
        api, token, chat_id, "photo.png", album_id=album_id, mime="image/png"
    )
    assert ok.status_code == 200, ok.text

    document = await _upload(
        api, token, chat_id, "doc.txt", b"hello", album_id=album_id, mime="text/plain"
    )
    assert document.status_code == 400
    assert "изображения" in document.json()["detail"]

    sticker = await _upload(
        api,
        token,
        chat_id,
        "photo.png",
        album_id=album_id,
        mime="image/png",
        sticker="true",
    )
    assert sticker.status_code == 400

    view_once = await _upload(
        api,
        token,
        chat_id,
        "photo.png",
        album_id=album_id,
        mime="image/png",
        view_once="true",
    )
    assert view_once.status_code == 400

    # Добираем альбом до предела и проверяем, что лишняя часть отбивается.
    for index in range(1, 10):
        response = await _upload(
            api,
            token,
            chat_id,
            f"photo_{index}.png",
            album_id=album_id,
            mime="image/png",
        )
        assert response.status_code == 200, response.text

    extra = await _upload(
        api, token, chat_id, "photo_10.png", album_id=album_id, mime="image/png"
    )
    assert extra.status_code == 400
    assert "не больше" in extra.json()["detail"]


@needs_db
async def test_album_sends_single_push(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Push — один на альбом, а не на каждый файл пачки."""
    user = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(user)
    chat_id = (await api.private_chat(token, peer.id))["id"]
    album_id = _album_id()

    captured: list[tuple[list[int], int, dict]] = []

    def fake_enqueue(recipients: list[int], chat_id: int, payload: dict) -> None:
        captured.append((list(recipients), chat_id, payload))

    monkeypatch.setattr(
        "api_v1.events.service._maybe_enqueue_message_push", fake_enqueue
    )

    for index in range(3):
        response = await _upload(
            api,
            token,
            chat_id,
            f"photo_{index}.png",
            album_id=album_id,
            mime="image/png",
        )
        assert response.status_code == 200, response.text

    assert (
        len(captured) == 1
    ), f"ожидали одно уведомление на альбом, а не {len(captured)}"
    recipients, _, payload = captured[0]
    assert peer.id in recipients
    assert payload["type"] == "message.new"


@needs_db
async def test_album_counts_rate_limit_once(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Лимит частоты загрузок — на альбом: пачка его не «проедает»."""
    user = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(user)
    chat_id = (await api.private_chat(token, peer.id))["id"]
    album_id = _album_id()

    monkeypatch.setattr("core.config.settings.message_upload_limit_per_minute", 1)

    for index in range(3):
        response = await _upload(
            api,
            token,
            chat_id,
            f"photo_{index}.png",
            album_id=album_id,
            mime="image/png",
        )
        assert response.status_code == 200, response.text

    # Одиночное вложение после альбома — уже второй «запрос» и упирается в лимит.
    blocked = await _upload(api, token, chat_id, "solitary.png")
    assert blocked.status_code == 429
