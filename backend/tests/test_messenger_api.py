"""HTTP API-тесты мессенджера: чаты и сообщения (нужен PostgreSQL).

Полноценные интеграционные тесты «через HTTP»: реальный ASGI-инстанс приложения,
реальные JWT-токены (fastapi-users) и тестовая БД. Покрывают основные сценарии:
личные чаты (создание/список), отправка/чтение сообщений, пагинация
(limit+before_id), ответы, реакции, закрепление, редактирование, пересылка со
снимком, удаление сообщения и удаление чата («для себя»/«для всех»).

Запускаются только при заданном TEST_DATABASE_URL (как остальные БД-тесты;
в CI его предоставляет сервис postgres). Схема должна быть накатана alembic.
"""

from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.models import User, db_helper

pytestmark = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


class _ApiCtx:
    """Контекст API-теста: клиент, фабрика сессий и хелперы."""

    def __init__(self, client: object, factory: async_sessionmaker) -> None:
        self.client = client
        self.factory = factory

    async def make_user(
        self, *, username: str | None = None, phone_number: str | None = None
    ) -> User:
        async with self.factory() as session:
            user = User(
                username=username or f"user_{uuid.uuid4().hex[:10]}",
                phone_number=phone_number,
                hashed_password="x",  # в этих тестах пароль не проверяется
                is_active=True,
                is_superuser=False,
                is_verified=False,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            return user

    async def token_for(self, user: User) -> str:
        from api_v1.auth.jwt import get_jwt_strategy

        return await get_jwt_strategy().write_token(user)

    def auth(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    async def private_chat(self, token: str, other_user_id: int) -> dict:
        response = await self.client.post(
            "/api/v1/chats/private/",
            json={"user_id": other_user_id},
            headers=self.auth(token),
        )
        assert response.status_code == 200, response.text
        return response.json()

    async def send(self, token: str, chat_id: int, text_body: str) -> dict:
        response = await self.client.post(
            "/api/v1/messages/",
            json={"chat_id": chat_id, "text": text_body},
            headers=self.auth(token),
        )
        assert response.status_code == 200, response.text
        return response.json()

    async def list_messages(
        self, token: str, chat_id: int, **params
    ) -> list[dict]:
        response = await self.client.get(
            f"/api/v1/messages/{chat_id}/",
            params=params,
            headers=self.auth(token),
        )
        assert response.status_code == 200, response.text
        return response.json()


@pytest_asyncio.fixture
async def api() -> _ApiCtx:
    """httpx-клиент поверх приложения с тестовой БД.

    - таблицы очищаются перед каждым тестом;
    - ``session_dependency`` подменяется на сессии тестовой БД;
    - lifespan (RabbitMQ-мост realtime) не запускается: соединений WS нет,
      поэтому публикация событий — безопасный no-op.

    ``httpx`` импортируется здесь (не на верхнем уровне), чтобы модуль можно
    было коллекционировать/скипать без установленного httpx.
    """
    from httpx import ASGITransport, AsyncClient

    from main import app

    engine = create_async_engine(os.environ["TEST_DATABASE_URL"])

    async with engine.begin() as conn:
        table_names = (
            (
                await conn.execute(
                    text(
                        "SELECT tablename FROM pg_tables "
                        "WHERE schemaname = 'public' AND tablename <> 'alembic_version'"
                    )
                )
            )
            .scalars()
            .all()
        )
        if table_names:
            quoted = ", ".join(f'"public"."{name}"' for name in table_names)
            await conn.execute(text(f"TRUNCATE TABLE {quoted} CASCADE"))

    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _override_session():
        async with factory() as session:
            yield session

    app.dependency_overrides[db_helper.session_dependency] = _override_session
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test"
    ) as client:
        try:
            yield _ApiCtx(client, factory)
        finally:
            app.dependency_overrides.clear()
            # Сбрасываем in-memory состояние между тестами: скользящий rate
            # limiter и «замки» OTP-номеров живут в процессе и иначе «протекали»
            # бы между тестами (лимиты/блокировки из одного теста — в другой).
            from api_v1.auth import otp_storage
            from api_v1.rate_limit import rate_limiter

            rate_limiter._windows.clear()
            otp_storage._verify_lockouts.clear()
            await engine.dispose()


# --- Личные чаты ---------------------------------------------------------


async def test_private_chat_find_or_create_and_visible_to_both(
    api: _ApiCtx,
) -> None:
    u1 = await api.make_user()
    u2 = await api.make_user()
    u3 = await api.make_user()
    t1, t2, t3 = (
        await api.token_for(u1),
        await api.token_for(u2),
        await api.token_for(u3),
    )

    chat = await api.private_chat(t1, u2.id)
    assert chat["id"] > 0
    member_ids = {u["id"] for u in chat["users"]}
    assert member_ids == {u1.id, u2.id}
    assert chat["last_message"] is None

    # Повторный вызов возвращает ТОТ ЖЕ чат (find-or-create).
    again = await api.private_chat(t1, u2.id)
    assert again["id"] == chat["id"]

    # Оба участника видят чат в своём списке, посторонний — нет.
    list1 = (
        await api.client.get("/api/v1/chats/", headers=api.auth(t1))
    ).json()
    list2 = (
        await api.client.get("/api/v1/chats/", headers=api.auth(t2))
    ).json()
    list3 = (
        await api.client.get("/api/v1/chats/", headers=api.auth(t3))
    ).json()
    assert any(c["id"] == chat["id"] for c in list1)
    assert any(c["id"] == chat["id"] for c in list2)
    assert all(c["id"] != chat["id"] for c in list3)


# --- Отправка и список сообщений -----------------------------------------


async def test_send_message_and_read_marks_incoming_read(api: _ApiCtx) -> None:
    u1 = await api.make_user()
    u2 = await api.make_user()
    t1, t2 = await api.token_for(u1), await api.token_for(u2)
    chat = await api.private_chat(t1, u2.id)

    msg = await api.send(t1, chat["id"], "привет мир")
    assert msg["text"] == "привет мир"
    assert msg["user_id"] == u1.id
    assert msg["reactions"] == []
    assert msg["forwarded_from"] is None

    # Собеседник читает — входящее помечается прочитанным.
    listed = await api.list_messages(t2, chat["id"])
    assert [m["id"] for m in listed] == [msg["id"]]
    assert listed[0]["is_read"] is True


async def test_non_member_cannot_read_messages(api: _ApiCtx) -> None:
    u1 = await api.make_user()
    u2 = await api.make_user()
    outsider = await api.make_user()
    t1 = await api.token_for(u1)
    tout = await api.token_for(outsider)
    chat = await api.private_chat(t1, u2.id)
    await api.send(t1, chat["id"], "секрет")

    response = await api.client.get(
        f"/api/v1/messages/{chat['id']}/",
        headers=api.auth(tout),
    )
    assert response.status_code == 403


# --- Пагинация (default limit + before_id) -------------------------------


async def test_messages_pagination(api: _ApiCtx) -> None:
    u1 = await api.make_user()
    u2 = await api.make_user()
    t1 = await api.token_for(u1)
    chat = await api.private_chat(t1, u2.id)

    sent = [await api.send(t1, chat["id"], f"msg-{i}") for i in range(5)]
    ids = [m["id"] for m in sent]

    # Дефолт (без параметров) — последние 100: все 5 в хронологическом порядке.
    all_msgs = await api.list_messages(t1, chat["id"])
    assert [m["id"] for m in all_msgs] == ids

    # limit=2 — только две последние (в хронологическом порядке).
    last_two = await api.list_messages(t1, chat["id"], limit=2)
    assert [m["id"] for m in last_two] == ids[-2:]

    # before_id=msg3 + limit=2 — две более старые (msg1, msg2).
    older = await api.list_messages(
        t1, chat["id"], limit=2, before_id=sent[3]["id"]
    )
    assert [m["id"] for m in older] == ids[1:3]

    # Пагинация до начала истории не зацикливается.
    exhausted = await api.list_messages(
        t1, chat["id"], limit=2, before_id=sent[1]["id"]
    )
    assert [m["id"] for m in exhausted] == ids[:1]


# --- Ответы, реакции ------------------------------------------------------


async def test_reply_and_reactions(api: _ApiCtx) -> None:
    u1 = await api.make_user()
    u2 = await api.make_user()
    t1, t2 = await api.token_for(u1), await api.token_for(u2)
    chat = await api.private_chat(t1, u2.id)

    base = await api.send(t1, chat["id"], "базовое")
    reply = await api.send(t2, chat["id"], "ответ")
    # Установить reply_to_id можно только при отправке; проверим через прямой POST.
    resp = await api.client.post(
        "/api/v1/messages/",
        json={
            "chat_id": chat["id"],
            "text": "ответ с цитатой",
            "reply_to_id": base["id"],
        },
        headers=api.auth(t2),
    )
    assert resp.status_code == 200, resp.text
    quoted = resp.json()
    assert quoted["reply_to_id"] == base["id"]
    assert reply["reply_to_id"] is None

    # u2 ставит реакцию — для него reacted_by_me=True.
    put = await api.client.put(
        f"/api/v1/messages/{base['id']}/reaction/",
        json={"emoji": "👍"},
        headers=api.auth(t2),
    )
    assert put.status_code == 200, put.text
    reactions = put.json()["reactions"]
    assert {"emoji": "👍", "count": 1, "reacted_by_me": True} in reactions

    # u1 видит ту же реакцию с reacted_by_me=False.
    listed = await api.list_messages(t1, chat["id"])
    base_view = next(m for m in listed if m["id"] == base["id"])
    thumbs = next(r for r in base_view["reactions"] if r["emoji"] == "👍")
    assert thumbs["count"] == 1 and thumbs["reacted_by_me"] is False

    # u2 снимает реакцию.
    delete = await api.client.delete(
        f"/api/v1/messages/{base['id']}/reaction/",
        headers=api.auth(t2),
    )
    assert delete.status_code == 200
    assert delete.json()["reactions"] == []


# --- Закрепление сообщений -----------------------------------------------


async def test_pin_and_pinned_list(api: _ApiCtx) -> None:
    u1 = await api.make_user()
    u2 = await api.make_user()
    t1 = await api.token_for(u1)
    chat = await api.private_chat(t1, u2.id)

    msg = await api.send(t1, chat["id"], "закреплю это")
    resp = await api.client.patch(
        f"/api/v1/messages/{msg['id']}/pin/",
        json={"is_pinned": True},
        headers=api.auth(t1),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_pinned"] is True

    pinned = await api.client.get(
        f"/api/v1/messages/{chat['id']}/pinned/",
        headers=api.auth(t1),
    )
    assert pinned.status_code == 200
    assert [m["id"] for m in pinned.json()] == [msg["id"]]

    await api.client.patch(
        f"/api/v1/messages/{msg['id']}/pin/",
        json={"is_pinned": False},
        headers=api.auth(t1),
    )
    pinned2 = (
        await api.client.get(
            f"/api/v1/messages/{chat['id']}/pinned/",
            headers=api.auth(t1),
        )
    ).json()
    assert pinned2 == []


# --- Редактирование -------------------------------------------------------


async def test_edit_message_author_only(api: _ApiCtx) -> None:
    u1 = await api.make_user()
    u2 = await api.make_user()
    t1, t2 = await api.token_for(u1), await api.token_for(u2)
    chat = await api.private_chat(t1, u2.id)
    msg = await api.send(t1, chat["id"], "старый текст")

    resp = await api.client.patch(
        f"/api/v1/messages/{msg['id']}/",
        json={"text": "новый текст"},
        headers=api.auth(t1),
    )
    assert resp.status_code == 200, resp.text
    edited = resp.json()
    assert edited["text"] == "новый текст"
    assert edited["edited_at"] is not None

    # Чужой участник редактировать не может.
    foreign = await api.client.patch(
        f"/api/v1/messages/{msg['id']}/",
        json={"text": "взлом"},
        headers=api.auth(t2),
    )
    assert foreign.status_code == 403


# --- Пересылка со снимком -------------------------------------------------


async def test_forward_message_keeps_source_snapshot(api: _ApiCtx) -> None:
    u1 = await api.make_user()
    u2 = await api.make_user()
    u3 = await api.make_user()
    t1 = await api.token_for(u1)
    chat_a = await api.private_chat(t1, u2.id)
    chat_b = await api.private_chat(t1, u3.id)

    source = await api.send(t1, chat_a["id"], "пересылаемый текст")
    resp = await api.client.post(
        "/api/v1/messages/forward/",
        json={"message_id": source["id"], "chat_id": chat_b["id"]},
        headers=api.auth(t1),
    )
    assert resp.status_code == 200, resp.text
    forwarded = resp.json()
    assert forwarded["chat_id"] == chat_b["id"]
    assert forwarded["text"] == "пересылаемый текст"
    assert forwarded["id"] != source["id"]
    # Плашка «Переслано от …» — снимок исходного сообщения.
    fwd = forwarded["forwarded_from"]
    assert fwd is not None
    assert fwd["id"] == source["id"]
    assert fwd["sender_id"] == u1.id
    assert fwd["chat_id"] == chat_a["id"]

    # Получатель в целевом чате видит пересланное.
    listed = await api.list_messages(t1, chat_b["id"])
    assert any(m["id"] == forwarded["id"] for m in listed)


async def test_forward_to_chat_where_not_member_forbidden(api: _ApiCtx) -> None:
    u1 = await api.make_user()
    u2 = await api.make_user()
    u3 = await api.make_user()
    t1, t3 = await api.token_for(u1), await api.token_for(u3)
    chat_a = await api.private_chat(t1, u2.id)
    # u3 состоит только в своём чате с u1.
    chat_c = await api.private_chat(t3, u1.id)

    source = await api.send(t1, chat_a["id"], "x")
    # u3 пересылает в чат chat_a, где он не участник.
    resp = await api.client.post(
        "/api/v1/messages/forward/",
        json={"message_id": source["id"], "chat_id": chat_a["id"]},
        headers=api.auth(t3),
    )
    assert resp.status_code == 403

    # u1 пересылает в чат chat_c — там он участник, всё ок (свой источник тоже).
    resp_ok = await api.client.post(
        "/api/v1/messages/forward/",
        json={"message_id": source["id"], "chat_id": chat_c["id"]},
        headers=api.auth(t1),
    )
    assert resp_ok.status_code == 200, resp_ok.text


# --- Удаление сообщения ---------------------------------------------------


async def test_delete_message_author_only(api: _ApiCtx) -> None:
    u1 = await api.make_user()
    u2 = await api.make_user()
    t1, t2 = await api.token_for(u1), await api.token_for(u2)
    chat = await api.private_chat(t1, u2.id)
    msg = await api.send(t1, chat["id"], "удалю это")

    # Чужой удалить не может.
    foreign = await api.client.delete(
        f"/api/v1/messages/{msg['id']}/",
        headers=api.auth(t2),
    )
    assert foreign.status_code == 403

    # Автор удаляет (204) — сообщение исчезает из истории.
    deleted = await api.client.delete(
        f"/api/v1/messages/{msg['id']}/",
        headers=api.auth(t1),
    )
    assert deleted.status_code == 204
    remaining = await api.list_messages(t1, chat["id"])
    assert all(m["id"] != msg["id"] for m in remaining)


# --- Удаление чата: «для себя» и «для всех» -------------------------------


async def test_delete_chat_for_me_keeps_history_for_peer(api: _ApiCtx) -> None:
    u1 = await api.make_user()
    u2 = await api.make_user()
    t1, t2 = await api.token_for(u1), await api.token_for(u2)
    chat = await api.private_chat(t1, u2.id)
    await api.send(t1, chat["id"], "до удаления")

    resp = await api.client.delete(
        f"/api/v1/chats/{chat['id']}/",
        headers=api.auth(t1),
    )
    assert resp.status_code == 204

    # У u1 чат исчез, у u2 остался с историей.
    list1 = (
        await api.client.get("/api/v1/chats/", headers=api.auth(t1))
    ).json()
    list2 = (
        await api.client.get("/api/v1/chats/", headers=api.auth(t2))
    ).json()
    assert all(c["id"] != chat["id"] for c in list1)
    assert any(c["id"] == chat["id"] for c in list2)
    assert await api.list_messages(t2, chat["id"])

    # Повторный find-or-create даёт НОВЫЙ чат (членство u1 удалено).
    new_chat = await api.private_chat(t1, u2.id)
    assert new_chat["id"] != chat["id"]


async def test_delete_chat_for_all_removes_for_everyone(api: _ApiCtx) -> None:
    u1 = await api.make_user()
    u2 = await api.make_user()
    t1, t2 = await api.token_for(u1), await api.token_for(u2)
    chat = await api.private_chat(t1, u2.id)

    resp = await api.client.delete(
        f"/api/v1/chats/{chat['id']}/?for_all=true",
        headers=api.auth(t1),
    )
    assert resp.status_code == 204

    list1 = (
        await api.client.get("/api/v1/chats/", headers=api.auth(t1))
    ).json()
    list2 = (
        await api.client.get("/api/v1/chats/", headers=api.auth(t2))
    ).json()
    assert all(c["id"] != chat["id"] for c in list1)
    assert all(c["id"] != chat["id"] for c in list2)

    # История удалена целиком: у «оставшегося» пользователя 404 на чтении.
    resp_old = await api.client.get(
        f"/api/v1/messages/{chat['id']}/",
        headers=api.auth(t2),
    )
    assert resp_old.status_code == 404


# --- OTP-вход (полный пользовательский сценарий) ---------------------------


def _random_phone() -> str:
    """Случайный номер в формате +7XXXXXXXXXX (валиден для PHONE_PATTERN)."""
    digits = "".join(c for c in uuid.uuid4().hex if c.isdigit())
    return f"+7{digits[:10].ljust(10, '0')}"


async def _request_otp(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch, phone: str
) -> str:
    """Запрашивает OTP-код, перехватывая «SMS-отправку» и возвращая код."""
    captured: list[str] = []

    def _fake_enqueue(phone_number: str, otp_code: str) -> None:
        captured.append(otp_code)

    # Подменяем реальную постановку задачи в Celery: код запоминаем, в очередь
    # (RabbitMQ) ничего не уходит.
    monkeypatch.setattr("api_v1.auth.views.enqueue_sms_otp", _fake_enqueue)
    resp = await api.client.post(
        "/api/v1/auth/request-otp/",
        json={"phone_number": phone},
    )
    assert resp.status_code == 200, resp.text
    assert len(captured) == 1
    return captured[0]


async def test_otp_full_login_flow(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Запросили код → ввели верный → получили токены → /users/me видит номер."""
    phone = _random_phone()
    code = await _request_otp(api, monkeypatch, phone)

    verify = await api.client.post(
        "/api/v1/auth/verify-otp/",
        json={"phone_number": phone, "otp": code},
    )
    assert verify.status_code == 200, verify.text
    data = verify.json()
    assert data["access_token"]
    assert data["refresh_token"]
    assert data["token_type"] == "bearer"

    # Access-токен реально работает: профиль текущего пользователя.
    me = await api.client.get(
        "/api/v1/jwt/users/me/",
        headers=api.auth(data["access_token"]),
    )
    assert me.status_code == 200, me.text
    assert me.json()["phone_number"] == phone


async def test_otp_wrong_code_rejected_then_correct(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    phone = _random_phone()
    code = await _request_otp(api, monkeypatch, phone)

    bad = await api.client.post(
        "/api/v1/auth/verify-otp/",
        json={"phone_number": phone, "otp": "000000"},
    )
    assert bad.status_code == 401

    good = await api.client.post(
        "/api/v1/auth/verify-otp/",
        json={"phone_number": phone, "otp": code},
    )
    assert good.status_code == 200, good.text


async def test_otp_bruteforce_burns_code_and_locks_phone(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """После исчерпания попыток номер блокируется — даже верный код не пройдёт."""
    phone = _random_phone()
    await _request_otp(api, monkeypatch, phone)

    # Пять неверных попыток — 401 (попытки копятся в otp_codes.attempts).
    for _ in range(5):
        resp = await api.client.post(
            "/api/v1/auth/verify-otp/",
            json={"phone_number": phone, "otp": "000000"},
        )
        assert resp.status_code == 401, resp.text

    # Шестая попытка: код «сгорел» → 429.
    burned = await api.client.post(
        "/api/v1/auth/verify-otp/",
        json={"phone_number": phone, "otp": "000000"},
    )
    assert burned.status_code == 429

    # Номер взят на паузу: дальнейший ввод (даже верного кода) → 429.
    locked = await api.client.post(
        "/api/v1/auth/verify-otp/",
        json={"phone_number": phone, "otp": "999999"},
    )
    assert locked.status_code == 429


# --- Per-user rate limit на «дорогих»/«писательских» эндпоинтах ------------


async def test_send_message_rate_limit(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Превышение лимита отправки одним пользователем → 429."""
    from core.config import settings

    monkeypatch.setattr(settings, "message_send_limit_per_minute", 3)

    u1 = await api.make_user()
    u2 = await api.make_user()
    t1 = await api.token_for(u1)
    chat = await api.private_chat(t1, u2.id)

    # Первые три отправки проходят.
    for _ in range(3):
        await api.send(t1, chat["id"], "норм")

    # Четвёртая — 429 (лимит на пользователя, не на IP).
    resp = await api.client.post(
        "/api/v1/messages/",
        json={"chat_id": chat["id"], "text": "лишнее"},
        headers=api.auth(t1),
    )
    assert resp.status_code == 429

    # Другой пользователь своим лимитом не исчерпан (ключ — user.id).
    t2 = await api.token_for(u2)
    ok = await api.client.post(
        "/api/v1/messages/",
        json={"chat_id": chat["id"], "text": "от второго"},
        headers=api.auth(t2),
    )
    assert ok.status_code == 200, ok.text


async def test_user_search_rate_limit(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Поиск людей тоже ограничен в минуту на пользователя."""
    from core.config import settings

    monkeypatch.setattr(settings, "user_search_limit_per_minute", 2)

    me = await api.make_user()
    target = await api.make_user()
    token = await api.token_for(me)
    query = target.username[:8]

    for _ in range(2):
        resp = await api.client.get(
            "/api/v1/users/search/",
            params={"q": query},
            headers=api.auth(token),
        )
        assert resp.status_code == 200, resp.text

    limited = await api.client.get(
        "/api/v1/users/search/",
        params={"q": query},
        headers=api.auth(token),
    )
    assert limited.status_code == 429


# --- Профили/чаты пользователей не должны быть публичными ------------------


async def test_users_no_public_listing_or_foreign_chats(api: _ApiCtx) -> None:
    """Список всех, профиль по id и чужие чаты больше не отдаются публично."""
    me = await api.make_user()
    token = await api.token_for(me)

    # Публичного «списка всех пользователей» больше нет.
    listing = await api.client.get("/api/v1/users/")
    assert listing.status_code != 200

    # Профиль произвольного пользователя по id — маршрут удалён (не 200).
    by_id = await api.client.get(f"/api/v1/users/{me.id}/")
    assert by_id.status_code == 404

    # Чужие чаты не отдаются: маршрут удалён.
    foreign_chats = await api.client.get(
        f"/api/v1/users/{me.id}/chats/",
        headers=api.auth(token),
    )
    assert foreign_chats.status_code == 404

    # «Свои» данные по-прежнему доступны через /jwt/users/me.
    me_resp = await api.client.get(
        "/api/v1/jwt/users/me/",
        headers=api.auth(token),
    )
    assert me_resp.status_code == 200, me_resp.text


# --- Поиск сообщений через API --------------------------------------------


async def test_search_messages_via_api(api: _ApiCtx) -> None:
    u1 = await api.make_user()
    u2 = await api.make_user()
    t1 = await api.token_for(u1)
    chat = await api.private_chat(t1, u2.id)

    first = await api.send(t1, chat["id"], "альфа бета")
    await api.send(t1, chat["id"], "гамма")

    # Глобальный поиск по всем своим чатам.
    resp = await api.client.get(
        "/api/v1/messages/search/",
        params={"q": "бета"},
        headers=api.auth(t1),
    )
    assert resp.status_code == 200, resp.text
    found = resp.json()
    assert [m["id"] for m in found] == [first["id"]]

    # Поиск в пределах конкретного чата.
    scoped = await api.client.get(
        "/api/v1/messages/search/",
        params={"q": "бета", "chat_id": chat["id"]},
        headers=api.auth(t1),
    )
    assert scoped.status_code == 200
    assert [m["id"] for m in scoped.json()] == [first["id"]]

    # Нет совпадений — пусто.
    empty = await api.client.get(
        "/api/v1/messages/search/",
        params={"q": "ничеготакого"},
        headers=api.auth(t1),
    )
    assert empty.status_code == 200
    assert empty.json() == []

    # Не-участник искать в чужом чате не может.
    outsider = await api.make_user()
    t_out = await api.token_for(outsider)
    forbidden = await api.client.get(
        "/api/v1/messages/search/",
        params={"q": "бета", "chat_id": chat["id"]},
        headers=api.auth(t_out),
    )
    assert forbidden.status_code == 403


# --- Список чатов: last_message и счётчик непрочитанных --------------------


async def test_chats_last_message_and_unread_count(api: _ApiCtx) -> None:
    u1 = await api.make_user()
    u2 = await api.make_user()
    t1, t2 = await api.token_for(u1), await api.token_for(u2)
    chat = await api.private_chat(t1, u2.id)

    await api.send(t1, chat["id"], "привет собеседник")

    # Собеседник видит чат: last_message + 1 непрочитанное.
    list2 = (
        await api.client.get("/api/v1/chats/", headers=api.auth(t2))
    ).json()
    item2 = next(c for c in list2 if c["id"] == chat["id"])
    assert item2["last_message"]["text"] == "привет собеседник"
    assert item2["unread_count"] == 1

    # Автор своих сообщений непрочитанными не считает.
    list1 = (
        await api.client.get("/api/v1/chats/", headers=api.auth(t1))
    ).json()
    item1 = next(c for c in list1 if c["id"] == chat["id"])
    assert item1["unread_count"] == 0

    # Собеседник открыл чат (GET истории) — прочитано, счётчик обнулился.
    await api.list_messages(t2, chat["id"])
    list2b = (
        await api.client.get("/api/v1/chats/", headers=api.auth(t2))
    ).json()
    item2b = next(c for c in list2b if c["id"] == chat["id"])
    assert item2b["unread_count"] == 0
    assert item2b["last_message"]["is_read"] is True
