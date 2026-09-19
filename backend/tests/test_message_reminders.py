"""Напоминания о сообщении: «напомнить мне» (нужен PostgreSQL).

Смысл функции — напоминание должно сработать, даже если приложение закрыто,
поэтому очередь живёт на сервере, а push отправляет воркер. Здесь проверяем
постановку (и отказы на неверное время/чужой чат), список и отмену, «один будильник
на сообщение» и то, что наступившее напоминание уходит из очереди в push-задачу.
Отдельно — текст уведомления: он не должен раскрывать содержимое при скрытом
превью и в E2EE-чате.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from api_v1.messages import crud as messages_crud
from core.models import Chat, Message, MessageReminder, User
from tasks.notifications import reminder_body, reminder_chat_label
from tests.test_messenger_api import _ApiCtx  # noqa: E402
from tests.test_messenger_api import api as api_fixture  # noqa: E402

api = api_fixture

needs_db = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


def _in(minutes: int) -> str:
    """Момент через N минут от сейчас (UTC со смещением)."""
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


async def _message(api: _ApiCtx, token: str, chat_id: int, text: str) -> dict:
    """Отправляет сообщение и возвращает его (нужен id для напоминания)."""
    return await api.send(token, chat_id, text)


async def _remind(api: _ApiCtx, token: str, message_id: int, when: str):
    """Ставит напоминание о сообщении через API."""
    return await api.client.post(
        f"/api/v1/messages/{message_id}/reminder/",
        json={"remind_at": when},
        headers=api.auth(token),
    )


async def _make_due(api: _ApiCtx, reminder_id: int) -> None:
    """Отматывает время напоминания назад: тест не должен ждать реальных минут."""
    async with api.factory() as session:
        row = await session.get(MessageReminder, reminder_id)
        assert row is not None
        row.remind_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
            seconds=1
        )
        await session.commit()


@needs_db
async def test_remind_and_list(api: _ApiCtx) -> None:
    """Напоминание сохраняется, видно в списке чата и снимается вручную."""
    author = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(author)
    peer_token = await api.token_for(peer)
    chat = await api.private_chat(token, peer.id)
    message = await _message(api, peer_token, chat["id"], "Не забудь про счёт")

    response = await _remind(api, token, message["id"], _in(90))
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["message_id"] == message["id"]
    assert payload["chat_id"] == chat["id"]
    assert payload["user_id"] == author.id

    listed = await api.client.get(
        f"/api/v1/messages/reminders/?chat_id={chat['id']}",
        headers=api.auth(token),
    )
    assert listed.status_code == 200, listed.text
    assert [item["id"] for item in listed.json()] == [payload["id"]]

    # Напоминание личное: собеседник его не видит.
    peer_list = await api.client.get(
        f"/api/v1/messages/reminders/?chat_id={chat['id']}",
        headers=api.auth(peer_token),
    )
    assert peer_list.json() == []

    cancelled = await api.client.delete(
        f"/api/v1/messages/reminders/{payload['id']}/",
        headers=api.auth(token),
    )
    assert cancelled.status_code == 204

    after = await api.client.get(
        f"/api/v1/messages/reminders/?chat_id={chat['id']}",
        headers=api.auth(token),
    )
    assert after.json() == []


@needs_db
async def test_remind_twice_moves_deadline(api: _ApiCtx) -> None:
    """Повторная постановка переносит срок, а не копит «будильники»."""
    author = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(author)
    peer_token = await api.token_for(peer)
    chat = await api.private_chat(token, peer.id)
    message = await _message(api, peer_token, chat["id"], "Одно сообщение")

    first = await _remind(api, token, message["id"], _in(60))
    second = await _remind(api, token, message["id"], _in(180))
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["id"] == second.json()["id"]

    listed = await api.client.get(
        f"/api/v1/messages/reminders/?chat_id={chat['id']}",
        headers=api.auth(token),
    )
    rows = listed.json()
    assert len(rows) == 1
    assert rows[0]["remind_at"] == second.json()["remind_at"]

    async with api.factory() as session:
        stored = await session.execute(
            select(MessageReminder).where(
                MessageReminder.user_id == author.id,
                MessageReminder.message_id == message["id"],
            )
        )
        assert len(stored.scalars().all()) == 1


@needs_db
async def test_remind_rejects_past_and_far_future(api: _ApiCtx) -> None:
    """Прошлое время и «через год» не принимаем — очередь не должна гнить."""
    author = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(author)
    peer_token = await api.token_for(peer)
    chat = await api.private_chat(token, peer.id)
    message = await _message(api, peer_token, chat["id"], "Текст")

    past = await _remind(api, token, message["id"], _in(-5))
    assert past.status_code == 400
    assert "будущем" in past.json()["detail"]

    far = await _remind(api, token, message["id"], _in(60 * 24 * 400))
    assert far.status_code == 400
    assert "год" in far.json()["detail"]


@needs_db
async def test_remind_requires_membership(api: _ApiCtx) -> None:
    """Напомнить о чужом сообщении нельзя — чат берётся из самого сообщения."""
    author = await api.make_user()
    peer = await api.make_user()
    outsider = await api.make_user()
    token = await api.token_for(author)
    outsider_token = await api.token_for(outsider)
    chat = await api.private_chat(token, peer.id)
    message = await _message(api, token, chat["id"], "Только для участников")

    response = await _remind(api, outsider_token, message["id"], _in(60))
    assert response.status_code == 403

    missing = await _remind(api, outsider_token, 9_999_999, _in(60))
    assert missing.status_code == 404


@needs_db
async def test_cancel_foreign_reminder_is_not_found(api: _ApiCtx) -> None:
    """Чужое напоминание не отдаём даже как «нет прав» — иначе видно чужие id."""
    author = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(author)
    peer_token = await api.token_for(peer)
    chat = await api.private_chat(token, peer.id)
    message = await _message(api, token, chat["id"], "Секрет")

    created = (await _remind(api, token, message["id"], _in(60))).json()

    response = await api.client.delete(
        f"/api/v1/messages/reminders/{created['id']}/",
        headers=api.auth(peer_token),
    )
    assert response.status_code == 404

    still_there = await api.client.get(
        f"/api/v1/messages/reminders/?chat_id={chat['id']}",
        headers=api.auth(token),
    )
    assert [item["id"] for item in still_there.json()] == [created["id"]]


@needs_db
async def test_due_reminder_leaves_queue(api: _ApiCtx) -> None:
    """Наступившее напоминание отдаётся задачей и уходит из очереди."""
    author = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(author)
    peer_token = await api.token_for(peer)
    chat = await api.private_chat(token, peer.id)
    message = await _message(api, peer_token, chat["id"], "Про это")

    created = (await _remind(api, token, message["id"], _in(30))).json()
    await _make_due(api, created["id"])

    async with api.factory() as session:
        due = await messages_crud.take_due_message_reminders(session)

    assert [item["message_id"] for item in due] == [message["id"]]
    assert due[0]["user_id"] == author.id
    assert due[0]["chat_id"] == chat["id"]

    # Повторный проход ничего не находит: запись удалена, вечного «напоминаем
    # каждую минуту» не будет.
    async with api.factory() as session:
        again = await messages_crud.take_due_message_reminders(session)
        left = await session.execute(
            select(MessageReminder).where(MessageReminder.id == created["id"])
        )
    assert again == []
    assert left.scalar_one_or_none() is None


@needs_db
async def test_reminder_disappears_with_message(api: _ApiCtx) -> None:
    """Удалили сообщение — напоминание о нём уходит вместе с ним."""
    author = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(author)
    chat = await api.private_chat(token, peer.id)
    message = await _message(api, token, chat["id"], "Скоро удалю")

    created = (await _remind(api, token, message["id"], _in(120))).json()
    deleted = await api.client.delete(
        f"/api/v1/messages/{message['id']}/", headers=api.auth(token)
    )
    assert deleted.status_code == 204

    async with api.factory() as session:
        left = await session.execute(
            select(MessageReminder).where(MessageReminder.id == created["id"])
        )
    assert left.scalar_one_or_none() is None


@needs_db
async def test_worker_task_queues_push(api: _ApiCtx, monkeypatch) -> None:
    """Задача воркера сама забирает очередь и ставит push-задачу.

    Ловим именно обвязку: ``make_session`` отдаёт готовую сессию, а не фабрику, и
    «async with session_factory()» падало бы уже в бою — в тестах crud такого не
    видно. Push-задачу подменяем: сети в тестах нет.
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from tasks import scheduled_tasks

    sent: list[dict] = []

    class _FakeTask:
        def delay(self, **kwargs: object) -> None:
            sent.append(dict(kwargs))

    author = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(author)
    peer_token = await api.token_for(peer)
    chat = await api.private_chat(token, peer.id)
    message = await _message(api, peer_token, chat["id"], "Пора вспомнить")

    created = (await _remind(api, token, message["id"], _in(30))).json()
    await _make_due(api, created["id"])

    engine = create_async_engine(os.environ["TEST_DATABASE_URL"])
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(scheduled_tasks, "make_engine", lambda: engine)
    monkeypatch.setattr(scheduled_tasks, "make_session", lambda _engine: factory())
    monkeypatch.setattr(scheduled_tasks, "get_task", lambda _name: _FakeTask())

    try:
        result = await scheduled_tasks._drain_reminders()
    finally:
        await engine.dispose()

    assert result == {"due": 1, "queued": 1}
    assert sent == [
        {
            "reminder_id": created["id"],
            "user_id": author.id,
            "chat_id": chat["id"],
            "message_id": message["id"],
        }
    ]

    # Повторный проход пуст: запись ушла из очереди (иначе «напоминаем» каждую
    # минуту навсегда).
    async with api.factory() as session:
        left = await session.execute(
            select(MessageReminder).where(MessageReminder.id == created["id"])
        )
    assert left.scalar_one_or_none() is None


def test_reminder_chat_label_never_shows_technical_name() -> None:
    """Личный чат называется по собеседнику, а не `phone_…` из БД.

    Живая грабля: у личных чатов `Chat.name` техническое — в уведомлении оно
    выглядело бы как «Чат «phone_81385ee1»».
    """
    me = User(id=1, username="me")
    peer = User(id=2, username="anya", first_name="Аня")
    private = Chat(name="phone_81385ee1", is_group=False, is_self=False)
    private.users = [me, peer]

    assert reminder_chat_label(chat=private, user_id=1) == "Аня"
    # Личное имя из контактов важнее имени в профиле.
    assert reminder_chat_label(chat=private, user_id=1, contact_name="Мама") == "Мама"

    group = Chat(name="Проверка звонка", is_group=True)
    assert reminder_chat_label(chat=group, user_id=1) == "Проверка звонка"

    saved = Chat(name="phone_1", is_self=True)
    assert reminder_chat_label(chat=saved, user_id=1) == "Сохранённые сообщения"

    assert reminder_chat_label(chat=None, user_id=1) == "Чат"


def test_reminder_body_hides_content_when_preview_off() -> None:
    """Текст уведомления: чат называем всегда, содержимое — по настройке."""
    message = Message(text="Тайна", encrypted=False)

    assert reminder_body(label="Мама", message=message)[:4] == "Чат "
    assert "Тайна" in reminder_body(label="Мама", message=message)

    hidden = reminder_body(label="Мама", message=message, preview=False)
    assert "Тайна" not in hidden
    assert "Мама" in hidden


def test_reminder_body_never_leaks_e2ee_text() -> None:
    """E2EE-чат: в уведомлении нет шифротекста, только пометка о защите."""
    message = Message(text="base64-шифротекст-клиента", encrypted=True)

    body = reminder_body(label="Работа", message=message)
    assert "base64" not in body
    assert "🔒" in body

    attachment = Message(text="", encrypted=True, file_url="/media/enc_ab.bin")
    assert "Вложение" in reminder_body(label="Работа", message=attachment)

    # Сообщение удалили до срока — напоминание всё равно приводит в чат.
    assert reminder_body(label="Работа", message=None) == "Чат «Работа»"
