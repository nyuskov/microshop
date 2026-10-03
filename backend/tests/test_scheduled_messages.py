"""Отложенные сообщения: «отправить позже» (нужен PostgreSQL).

Смысл функции — сообщение должно уйти, даже если приложение закрыто, поэтому
очередь живёт на сервере, а разбирает её задача Celery. Здесь проверяем три
вещи: постановку в очередь (и отказы на неверное время/чужой чат), список и
отмену, а главное — что «наступившее» сообщение действительно попадает в чат и
что безнадёжные записи (автора замутили) не застревают в очереди навсегда.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from api_v1.messages import crud as messages_crud
from core.models import ScheduledMessage
from tests.api_support import _ApiCtx  # noqa: E402
from tests.api_support import api as api_fixture  # noqa: E402
from tests.test_group_invites import _group

api = api_fixture

needs_db = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


def _in(minutes: int) -> str:
    """Момент через N минут от сейчас (UTC со смещением)."""
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


async def _make_due(api: _ApiCtx, scheduled_id: int) -> None:
    """Отматывает время отправки назад: тест не должен ждать реальных минут."""
    async with api.factory() as session:
        row = await session.get(ScheduledMessage, scheduled_id)
        assert row is not None
        row.send_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
            seconds=1
        )
        await session.commit()


async def _schedule(
    api: _ApiCtx, token: str, chat_id: int, text: str, when: str
) -> dict:
    """Ставит сообщение в очередь и возвращает запись."""
    response = await api.client.post(
        "/api/v1/messages/scheduled/",
        json={"chat_id": chat_id, "text": text, "send_at": when},
        headers=api.auth(token),
    )
    assert response.status_code == 200, response.text
    return response.json()


@needs_db
async def test_schedule_and_list(api: _ApiCtx) -> None:
    """Отложенное сообщение сохраняется, видно в списке и его можно отменить."""
    author = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(author)
    chat = await api.private_chat(token, peer.id)

    scheduled = await _schedule(
        api, token, chat["id"], "Утреннее приветствие", _in(120)
    )
    assert scheduled["text"] == "Утреннее приветствие"
    assert scheduled["chat_id"] == chat["id"]
    assert scheduled["user_id"] == author.id

    listed = await api.client.get(
        f"/api/v1/messages/scheduled/?chat_id={chat['id']}",
        headers=api.auth(token),
    )
    assert listed.status_code == 200, listed.text
    assert [item["id"] for item in listed.json()] == [scheduled["id"]]

    # В самом чате сообщения пока нет — оно ждёт своего времени.
    assert await api.list_messages(token, chat["id"]) == []

    cancelled = await api.client.delete(
        f"/api/v1/messages/scheduled/{scheduled['id']}/",
        headers=api.auth(token),
    )
    assert cancelled.status_code == 204

    listed_after = await api.client.get(
        f"/api/v1/messages/scheduled/?chat_id={chat['id']}",
        headers=api.auth(token),
    )
    assert listed_after.json() == []


@needs_db
async def test_schedule_rejects_past_and_far_future(api: _ApiCtx) -> None:
    """Прошлое время и «через месяц» не принимаем — очередь не должна гнить."""
    author = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(author)
    chat = await api.private_chat(token, peer.id)

    past = await api.client.post(
        "/api/v1/messages/scheduled/",
        json={"chat_id": chat["id"], "text": "Поздно", "send_at": _in(-5)},
        headers=api.auth(token),
    )
    assert past.status_code == 400
    assert "будущем" in past.json()["detail"]

    far = await api.client.post(
        "/api/v1/messages/scheduled/",
        json={
            "chat_id": chat["id"],
            "text": "Слишком поздно",
            "send_at": _in(60 * 24 * 40),
        },
        headers=api.auth(token),
    )
    assert far.status_code == 400
    assert "30 дней" in far.json()["detail"]


@needs_db
async def test_schedule_requires_membership(api: _ApiCtx) -> None:
    """Отложить сообщение в чужой чат нельзя."""
    author = await api.make_user()
    peer = await api.make_user()
    outsider = await api.make_user()
    token = await api.token_for(author)
    outsider_token = await api.token_for(outsider)
    chat = await api.private_chat(token, peer.id)

    response = await api.client.post(
        "/api/v1/messages/scheduled/",
        json={
            "chat_id": chat["id"],
            "text": "Влезть в чужой чат",
            "send_at": _in(60),
        },
        headers=api.auth(outsider_token),
    )
    # Так же, как при обычной отправке: чужой чат — «не участник», а не «найдено».
    assert response.status_code == 403


@needs_db
async def test_cancel_foreign_schedule_is_not_found(api: _ApiCtx) -> None:
    """Чужую отмену не отдаём даже как «нет прав» — иначе видно чужие id."""
    author = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(author)
    peer_token = await api.token_for(peer)
    chat = await api.private_chat(token, peer.id)

    scheduled = await _schedule(api, token, chat["id"], "Секрет", _in(90))

    response = await api.client.delete(
        f"/api/v1/messages/scheduled/{scheduled['id']}/",
        headers=api.auth(peer_token),
    )
    assert response.status_code == 404

    # Запись по-прежнему на месте.
    still_there = await api.client.get(
        f"/api/v1/messages/scheduled/?chat_id={chat['id']}",
        headers=api.auth(token),
    )
    assert [item["id"] for item in still_there.json()] == [scheduled["id"]]


@needs_db
async def test_due_message_is_sent(api: _ApiCtx) -> None:
    """Наступившее время — задача отправляет сообщение и чистит очередь."""
    author = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(author)
    peer_token = await api.token_for(peer)
    chat = await api.private_chat(token, peer.id)

    scheduled = await _schedule(api, token, chat["id"], "Уже пора", _in(30))
    await _make_due(api, scheduled["id"])

    async with api.factory() as session:
        result = await messages_crud.send_due_scheduled_messages(session)
    assert result == {"sent": 1, "dropped": 0}

    # Сообщение пришло второму участнику, а очередь опустела.
    history = await api.list_messages(peer_token, chat["id"])
    assert "Уже пора" in [item["text"] for item in history]

    async with api.factory() as session:
        left = await session.execute(
            select(ScheduledMessage).where(ScheduledMessage.id == scheduled["id"])
        )
        assert left.scalar_one_or_none() is None


@needs_db
async def test_due_message_is_dropped_when_muted(api: _ApiCtx) -> None:
    """Автора замутили до срока: запись уходит из очереди, а не висит вечно."""
    creator = await api.make_user()
    member = await api.make_user()
    creator_token = await api.token_for(creator)
    member_token = await api.token_for(member)
    chat = await _group(api, creator_token, [member.id])

    scheduled = await _schedule(api, member_token, chat["id"], "Не судьба", _in(45))
    await _make_due(api, scheduled["id"])

    muted = await api.client.post(
        f"/api/v1/chats/{chat['id']}/members/{member.id}/mute/",
        json={"minutes": 60},
        headers=api.auth(creator_token),
    )
    assert muted.status_code == 200, muted.text

    async with api.factory() as session:
        result = await messages_crud.send_due_scheduled_messages(session)
    assert result == {"sent": 0, "dropped": 1}

    # В чате сообщения нет (мут), а очередь очищена — повтора каждую минуту нет.
    history = await api.list_messages(creator_token, chat["id"])
    assert "Не судьба" not in [item["text"] for item in history]

    async with api.factory() as session:
        left = await session.execute(
            select(ScheduledMessage).where(ScheduledMessage.id == scheduled["id"])
        )
        assert left.scalar_one_or_none() is None


@needs_db
async def test_worker_task_sends_due(api: _ApiCtx, monkeypatch) -> None:
    """Задача воркера сама доводит дело до отправки (обвязка движка/сессии).

    Здесь ловим именно грабли обвязки: ``make_session`` отдаёт готовую сессию, а
    не фабрику, и «async with session_factory()» падало бы уже в бою — в тестах
    crud-функция такого не покажет.
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from tasks import scheduled_tasks

    author = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(author)
    peer_token = await api.token_for(peer)
    chat = await api.private_chat(token, peer.id)

    scheduled_row = await _schedule(api, token, chat["id"], "Из воркера", _in(30))
    await _make_due(api, scheduled_row["id"])

    engine = create_async_engine(os.environ["TEST_DATABASE_URL"])
    factory = async_sessionmaker(engine, expire_on_commit=False)
    # Подменяем движок и сессию на тестовые: задача по умолчанию берёт БД из
    # настроек (рабочую), а тесты обязаны работать на своей.
    monkeypatch.setattr(scheduled_tasks, "make_engine", lambda: engine)
    monkeypatch.setattr(scheduled_tasks, "make_session", lambda _engine: factory())

    try:
        result = await scheduled_tasks._send_due()
    finally:
        await engine.dispose()

    assert result == {"sent": 1, "dropped": 0}
    history = await api.list_messages(peer_token, chat["id"])
    assert "Из воркера" in [item["text"] for item in history]
