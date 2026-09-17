"""История звонков отдельным экраном: ``GET /api/v1/calls/history/``.

Записей о звонках нет отдельной таблицей — это системные сообщения личного чата
(``Message.kind == "call"``). Эндпоинт собирает их по всем личным чатам человека,
свежие первыми, и добавляет то, что нужно экрану: собеседника, исход, тип
(аудио/видео) и направление звонка.

Проверяем: сбор по чатам, направление (звонил я или мне), порядок и страницы,
недоступность чужих звонков, пропуск скрытого модерацией и пустой список у того,
кто ещё не звонил.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import update

from core.models import Message
from tests.test_messenger_api import _ApiCtx  # noqa: E402
from tests.test_messenger_api import api as api_fixture  # noqa: E402

api = api_fixture

needs_db = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


def _now() -> datetime:
    """Naive UTC — колонка `messages.timestamp` без зоны (как в chat_stats)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _record(
    api: _ApiCtx,
    *,
    chat_id: int,
    caller_id: int,
    state: str,
    kind: str = "audio",
    duration: int = 0,
    minutes_ago: int = 0,
) -> int:
    """Кладёт в чат такую же запись о звонке, какую пишет сигналинг."""
    async with api.factory() as session:
        message = Message(
            text="",
            chat_id=chat_id,
            user_id=caller_id,
            kind="call",
            call_kind=kind,
            call_state=state,
            call_duration=duration,
            call_caller_id=caller_id,
            timestamp=_now() - timedelta(minutes=minutes_ago),
        )
        session.add(message)
        await session.commit()
        await session.refresh(message)
        return message.id


async def _history(api: _ApiCtx, token: str, **params) -> dict:
    response = await api.client.get(
        "/api/v1/calls/history/", params=params, headers=api.auth(token)
    )
    assert response.status_code == 200, response.text
    return response.json()


@needs_db
async def test_history_collects_calls_with_peer_and_direction(api: _ApiCtx) -> None:
    """Звонки из разных чатов попадают в одну ленту, свежие первыми."""
    me = await api.make_user()
    peer = await api.make_user()
    other = await api.make_user()
    token = await api.token_for(me)

    chat_peer = (await api.private_chat(token, peer.id))["id"]
    chat_other = (await api.private_chat(token, other.id))["id"]

    # Мне звонили (запись создал собеседник) — входящий пропущенный.
    await _record(
        api, chat_id=chat_peer, caller_id=peer.id, state="missed", minutes_ago=30
    )
    # Я звонил, поговорили две минуты — исходящий.
    await _record(
        api,
        chat_id=chat_peer,
        caller_id=me.id,
        state="completed",
        kind="video",
        duration=120,
        minutes_ago=10,
    )
    # Я звонил другому человеку, он отклонил — свежее всех.
    await _record(
        api, chat_id=chat_other, caller_id=me.id, state="declined", minutes_ago=1
    )

    data = await _history(api, token)
    assert data["total"] == 3
    items = data["items"]
    assert [item["call_state"] for item in items] == ["declined", "completed", "missed"]

    newest = items[0]
    assert newest["outgoing"] is True
    assert newest["peer"]["id"] == other.id
    assert newest["chat_id"] == chat_other
    assert newest["call_kind"] == "audio"

    # Входящий: направление определяем по инициатору, а не по автору сообщения.
    incoming = items[2]
    assert incoming["outgoing"] is False
    assert incoming["peer"]["id"] == peer.id
    assert incoming["call_duration"] == 0


@needs_db
async def test_history_pages_and_keeps_order(api: _ApiCtx) -> None:
    """Страницы не пересекаются и сохраняют порядок «свежие первыми»."""
    me = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(me)
    chat_id = (await api.private_chat(token, peer.id))["id"]

    for index in range(5):
        await _record(
            api,
            chat_id=chat_id,
            caller_id=me.id,
            state="completed",
            minutes_ago=index,
        )

    first = await _history(api, token, limit=2)
    second = await _history(api, token, limit=2, offset=2)
    assert first["total"] == second["total"] == 5
    assert len(first["items"]) == 2
    assert len(second["items"]) == 2
    ids = [item["id"] for item in first["items"] + second["items"]]
    assert len(set(ids)) == 4
    # Свежие сверху: время убывает. Проверяем именно время, а не id: id растут в
    # порядке вставки, а мы кладём записи от свежей к старой.
    stamps = [item["timestamp"] for item in first["items"] + second["items"]]
    assert stamps == sorted(stamps, reverse=True)


@needs_db
async def test_history_hides_other_people_calls(api: _ApiCtx) -> None:
    """В историю попадают только звонки из чатов, где человек участвует."""
    me = await api.make_user()
    peer = await api.make_user()
    other = await api.make_user()
    token = await api.token_for(me)
    other_token = await api.token_for(other)
    # Чужой чат: между собеседником и третьим человеком.
    stranger = await api.make_user()
    stranger_token = await api.token_for(stranger)
    foreign_chat = (await api.private_chat(other_token, stranger.id))["id"]
    await _record(api, chat_id=foreign_chat, caller_id=other.id, state="missed")

    my_chat = (await api.private_chat(token, peer.id))["id"]
    await _record(api, chat_id=my_chat, caller_id=me.id, state="completed")

    mine = await _history(api, token)
    assert mine["total"] == 1
    assert mine["items"][0]["chat_id"] == my_chat
    # Участник чужого звонка видит только своё.
    assert (await _history(api, stranger_token))["total"] == 1


@needs_db
async def test_history_skips_hidden_records(api: _ApiCtx) -> None:
    """Скрытая модерацией запись о звонке в истории не показывается."""
    me = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(me)
    chat_id = (await api.private_chat(token, peer.id))["id"]

    visible_id = await _record(
        api, chat_id=chat_id, caller_id=peer.id, state="missed", minutes_ago=5
    )
    hidden_id = await _record(
        api, chat_id=chat_id, caller_id=peer.id, state="missed", minutes_ago=1
    )
    async with api.factory() as session:
        await session.execute(
            update(Message).where(Message.id == hidden_id).values(hidden_at=_now())
        )
        await session.commit()

    data = await _history(api, token)
    assert data["total"] == 1
    assert [item["id"] for item in data["items"]] == [visible_id]


@needs_db
async def test_history_is_empty_before_any_calls(api: _ApiCtx) -> None:
    """Без звонков отдаём пустой список, а не ошибку (у экрана есть заглушка)."""
    me = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(me)
    chat_id = (await api.private_chat(token, peer.id))["id"]
    # Обычная переписка звонком не считается.
    await api.send(token, chat_id, "привет")

    data = await _history(api, token)
    assert data == {"items": [], "total": 0}


@needs_db
async def test_history_rejects_bad_paging(api: _ApiCtx) -> None:
    """Отрицательный offset и слишком большой limit отклоняются (422)."""
    me = await api.make_user()
    token = await api.token_for(me)
    for params in ({"offset": -1}, {"limit": 0}, {"limit": 500}):
        response = await api.client.get(
            "/api/v1/calls/history/", params=params, headers=api.auth(token)
        )
        assert response.status_code == 422, (params, response.text)
