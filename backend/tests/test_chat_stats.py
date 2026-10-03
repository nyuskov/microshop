"""Статистика чата: итоги, активность по дням, топ участников и медиа.

Эндпоинт ``GET /api/v1/chats/{id}/stats/`` собирает то, что уже лежит в БД:
сколько всего сообщений, как они распределены по дням (последние 30), кто
активнее и сколько вложений каждого типа. Скрытые модерацией сообщения не
считаем — они под вопросом и в статистике выглядели бы обычной активностью.

Проверяем: правильные числа и имена, недоступность постороннему, пропуск
скрытого и сдвиг дней по поясу зрителя (сервер живёт в UTC).
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from tests.api_support import _ApiCtx  # noqa: E402
from tests.api_support import api as api_fixture  # noqa: E402

api = api_fixture

#: Минимальный валидный PNG (1×1) — вложение «image».
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


async def _stats(api: _ApiCtx, token: str, chat_id: int, **params) -> dict:
    response = await api.client.get(
        f"/api/v1/chats/{chat_id}/stats/", params=params, headers=api.auth(token)
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _upload(api: _ApiCtx, token: str, chat_id: int, filename: str, body: bytes):
    response = await api.client.post(
        "/api/v1/messages/attachment/",
        params={"chat_id": chat_id, "filename": filename},
        content=body,
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 200, response.text
    return response.json()


@needs_db
async def test_stats_counts_messages_senders_and_media(api: _ApiCtx) -> None:
    """Итоги, топ отправителей и типы вложений считаются по чату."""
    user = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(user)
    peer_token = await api.token_for(peer)
    chat_id = (await api.private_chat(token, peer.id))["id"]

    await api.send(token, chat_id, "раз")
    await api.send(peer_token, chat_id, "два")
    await api.send(peer_token, chat_id, "три")
    await _upload(api, token, chat_id, "photo.png", PNG)
    await _upload(api, token, chat_id, "clip.mp4", b"\x00" * 32)

    stats = await _stats(api, token, chat_id)

    assert stats["messages_total"] == 5
    assert stats["media"] == {"image": 1, "video": 1, "audio": 0, "file": 0}
    assert stats["first_at"] is not None and stats["last_at"] is not None

    # Топ: у собеседника два сообщения, у нас три (текст + два вложения).
    assert [row["count"] for row in stats["top_senders"]] == [3, 2]
    assert stats["top_senders"][0]["user_id"] == user.id
    # Имя непустое: в интерфейсе по нему подписан столбик.
    assert all(row["name"] for row in stats["top_senders"])

    # Все сообщения — сегодня, поэтому день один и он же итог.
    assert len(stats["days"]) == 1
    assert stats["days"][0]["count"] == 5
    assert stats["days"][0]["date"] == datetime.now(timezone.utc).date().isoformat()


@needs_db
async def test_stats_only_for_chat_members(api: _ApiCtx) -> None:
    """Посторонний статистику не увидит: это производная от переписки."""
    user = await api.make_user()
    peer = await api.make_user()
    stranger = await api.make_user()
    chat_id = (await api.private_chat(await api.token_for(user), peer.id))["id"]

    response = await api.client.get(
        f"/api/v1/chats/{chat_id}/stats/",
        headers=api.auth(await api.token_for(stranger)),
    )
    assert response.status_code == 403, response.text


@needs_db
async def test_stats_skips_hidden_messages(api: _ApiCtx) -> None:
    """Скрытое модерацией сообщение в статистику не попадает."""
    user = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(user)
    chat_id = (await api.private_chat(token, peer.id))["id"]

    visible = await api.send(token, chat_id, "остаётся")
    hidden = await api.send(token, chat_id, "скрою")
    async with api.factory() as session:
        await session.execute(
            text("UPDATE messages SET hidden_at = now() WHERE id = :id"),
            {"id": hidden["id"]},
        )
        await session.commit()

    stats = await _stats(api, token, chat_id)
    assert stats["messages_total"] == 1
    assert [row["count"] for row in stats["top_senders"]] == [1]
    assert visible["id"] != hidden["id"]


@needs_db
async def test_stats_days_follow_viewer_timezone(api: _ApiCtx) -> None:
    """День считается по поясу зрителя: вечер UTC — уже следующие сутки в Москве."""
    user = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(user)
    chat_id = (await api.private_chat(token, peer.id))["id"]

    message = await api.send(token, chat_id, "вечернее сообщение")
    # Сообщение вчера в 22:30 UTC: в Москве (+180) это уже 01:30 следующего дня.
    # Колонка времени сообщения — naive (без зоны), поэтому и значение naive.
    stamp = (datetime.now(timezone.utc) - timedelta(days=1)).replace(
        hour=22, minute=30, second=0, microsecond=0, tzinfo=None
    )
    async with api.factory() as session:
        await session.execute(
            text("UPDATE messages SET timestamp = :ts WHERE id = :id"),
            {"ts": stamp, "id": message["id"]},
        )
        await session.commit()

    utc_stats = await _stats(api, token, chat_id, offset_minutes=0)
    local_stats = await _stats(api, token, chat_id, offset_minutes=180)

    assert utc_stats["days"][0]["date"] == stamp.date().isoformat()
    assert (
        local_stats["days"][0]["date"] == (stamp + timedelta(days=1)).date().isoformat()
    )
    # Счётчик тот же — сдвиг меняет день, а не число сообщений.
    assert utc_stats["days"][0]["count"] == local_stats["days"][0]["count"] == 1
