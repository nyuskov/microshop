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

    async def list_messages(self, token: str, chat_id: int, **params) -> list[dict]:
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
    async with AsyncClient(transport=transport, base_url="http://test") as client:
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
    list1 = (await api.client.get("/api/v1/chats/", headers=api.auth(t1))).json()
    list2 = (await api.client.get("/api/v1/chats/", headers=api.auth(t2))).json()
    list3 = (await api.client.get("/api/v1/chats/", headers=api.auth(t3))).json()
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
    older = await api.list_messages(t1, chat["id"], limit=2, before_id=sent[3]["id"])
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
    list1 = (await api.client.get("/api/v1/chats/", headers=api.auth(t1))).json()
    list2 = (await api.client.get("/api/v1/chats/", headers=api.auth(t2))).json()
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

    list1 = (await api.client.get("/api/v1/chats/", headers=api.auth(t1))).json()
    list2 = (await api.client.get("/api/v1/chats/", headers=api.auth(t2))).json()
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
    list2 = (await api.client.get("/api/v1/chats/", headers=api.auth(t2))).json()
    item2 = next(c for c in list2 if c["id"] == chat["id"])
    assert item2["last_message"]["text"] == "привет собеседник"
    assert item2["unread_count"] == 1

    # Автор своих сообщений непрочитанными не считает.
    list1 = (await api.client.get("/api/v1/chats/", headers=api.auth(t1))).json()
    item1 = next(c for c in list1 if c["id"] == chat["id"])
    assert item1["unread_count"] == 0

    # Собеседник открыл чат (GET истории) — прочитано, счётчик обнулился.
    await api.list_messages(t2, chat["id"])
    list2b = (await api.client.get("/api/v1/chats/", headers=api.auth(t2))).json()
    item2b = next(c for c in list2b if c["id"] == chat["id"])
    assert item2b["unread_count"] == 0
    assert item2b["last_message"]["is_read"] is True


# --- Привязка Telegram (резервный канал доставки OTP) ---------------------


async def test_telegram_bind_requires_auth(api: _ApiCtx) -> None:
    anon = await api.client.post("/api/v1/auth/telegram/bind/")
    assert anon.status_code == 401


async def test_telegram_bind_link_and_status(api: _ApiCtx) -> None:
    u = await api.make_user()
    token = await api.token_for(u)
    headers = api.auth(token)

    # Создание ссылки привязки.
    bind = await api.client.post("/api/v1/auth/telegram/bind/", headers=headers)
    assert bind.status_code == 200, bind.text
    body = bind.json()
    assert body["code"]
    # deep_link может отсутствовать (если username бота не задан), код — всегда.
    assert body.get("deep_link") is None or body["deep_link"].endswith(
        f"?start=bind_{body['code']}"
    )

    # Пока чат не привязан.
    status0 = (
        await api.client.get("/api/v1/auth/telegram/status/", headers=headers)
    ).json()
    assert status0["bound"] is False

    # Имитируем бота: он «привязал» чат (ставит tg_chat_id).
    async with api.factory() as session:
        db_user = await session.get(User, u.id)
        assert db_user is not None
        db_user.tg_chat_id = 123456789
        await session.commit()

    status1 = (
        await api.client.get("/api/v1/auth/telegram/status/", headers=headers)
    ).json()
    assert status1["bound"] is True

    # Отвязка.
    unbind = await api.client.post("/api/v1/auth/telegram/unbind/", headers=headers)
    assert unbind.status_code == 200
    assert unbind.json()["bound"] is False
    status2 = (
        await api.client.get("/api/v1/auth/telegram/status/", headers=headers)
    ).json()
    assert status2["bound"] is False


# --- Вход по паролю (временная замена OTP/SMS) ----------------------------


async def test_password_register_login_and_status(api: _ApiCtx) -> None:
    """Новый номер: статус без пароля → создаём пароль → вход по паролю."""
    phone = _random_phone()

    st0 = await api.client.post(
        "/api/v1/auth/password/status/", json={"phone_number": phone}
    )
    assert st0.status_code == 200, st0.text
    assert st0.json()["registered"] is False
    assert st0.json()["has_password"] is False

    # Короткий пароль отклоняется.
    short = await api.client.post(
        "/api/v1/auth/password/register/",
        json={"phone_number": phone, "password": "123"},
    )
    assert short.status_code == 400

    reg = await api.client.post(
        "/api/v1/auth/password/register/",
        json={"phone_number": phone, "password": "secret-pass-1"},
    )
    assert reg.status_code == 200, reg.text
    data = reg.json()
    assert data["access_token"] and data["refresh_token"]

    # Теперь у номера есть пароль.
    st1 = await api.client.post(
        "/api/v1/auth/password/status/", json={"phone_number": phone}
    )
    assert st1.json()["registered"] is True
    assert st1.json()["has_password"] is True

    # Повторная регистрация с паролем — нельзя.
    again = await api.client.post(
        "/api/v1/auth/password/register/",
        json={"phone_number": phone, "password": "another-pass-2"},
    )
    assert again.status_code == 400

    # Вход с неверным паролем — 401.
    bad = await api.client.post(
        "/api/v1/auth/password/login/",
        json={"phone_number": phone, "password": "wrong-pass"},
    )
    assert bad.status_code == 401

    # Вход с верным паролем даёт рабочий токен.
    login = await api.client.post(
        "/api/v1/auth/password/login/",
        json={"phone_number": phone, "password": "secret-pass-1"},
    )
    assert login.status_code == 200, login.text
    me = await api.client.get(
        "/api/v1/jwt/users/me/",
        headers=api.auth(login.json()["access_token"]),
    )
    assert me.status_code == 200
    assert me.json()["phone_number"] == phone


async def test_password_register_sets_password_for_otp_created_user(
    api: _ApiCtx,
) -> None:
    """Аккаунт, созданный ранее через OTP (без своего пароля), может задать его."""
    phone = _random_phone()

    # Симулируем OTP-аккаунт: пароль случайный, password_set=False.
    async with api.factory() as session:
        from core.models import User as _User

        user = _User(
            username=f"phone_{uuid.uuid4().hex[:8]}",
            phone_number=phone,
            hashed_password="not-a-real-password",
            is_active=True,
            is_verified=True,
        )
        session.add(user)
        await session.commit()

    st = await api.client.post(
        "/api/v1/auth/password/status/", json={"phone_number": phone}
    )
    assert st.json()["registered"] is True
    assert st.json()["has_password"] is False

    reg = await api.client.post(
        "/api/v1/auth/password/register/",
        json={"phone_number": phone, "password": "brand-new-pass"},
    )
    assert reg.status_code == 200, reg.text

    # Вход по заданному паролю работает.
    login = await api.client.post(
        "/api/v1/auth/password/login/",
        json={"phone_number": phone, "password": "brand-new-pass"},
    )
    assert login.status_code == 200, login.text


# --- Web Push (PWA-уведомления) -------------------------------------------


async def test_push_public_key_state(api: _ApiCtx) -> None:
    """Публичный ключ: с VAPID — отдаётся, без VAPID — пустой/выключен."""
    from core.config import settings

    r = await api.client.get("/api/v1/push/public-key/")
    assert r.status_code == 200, r.text
    body = r.json()
    if settings.web_push_vapid_public_key and settings.web_push_vapid_private_key:
        assert body["enabled"] is True
        assert len(body["public_key"]) > 0
    else:
        assert body["public_key"] == ""
        assert body["enabled"] is False


async def test_push_subscribe_requires_auth(api: _ApiCtx) -> None:
    """Регистрация подписки — только для авторизованного пользователя."""
    r = await api.client.post(
        "/api/v1/push/subscribe/",
        json={
            "endpoint": "https://push.example.com/sub/abc",
            "p256dh": "AAAA-test",
            "auth": "BBBB-test",
        },
    )
    assert r.status_code == 401


# --- RuStore Push (Android-приложение из RuStore) --------------------------


async def test_rustore_push_token_requires_auth(api: _ApiCtx) -> None:
    """Push-токен RuStore принимается только у авторизованного пользователя."""
    r = await api.client.post(
        "/api/v1/push/rustore/subscribe/",
        json={"token": "rustore-token-123456"},
    )
    assert r.status_code == 401


async def test_rustore_push_token_lifecycle(api: _ApiCtx) -> None:
    """Токен RuStore: сохранение, перепривязка к другому аккаунту, удаление."""
    from sqlalchemy import select

    from core.models import RuStorePushToken

    u1 = await api.make_user()
    u2 = await api.make_user()
    token = f"rt-{uuid.uuid4().hex}"

    r = await api.client.post(
        "/api/v1/push/rustore/subscribe/",
        json={"token": token},
        headers=api.auth(await api.token_for(u1)),
    )
    assert r.status_code == 200, r.text

    async with api.factory() as session:
        row = (
            await session.execute(
                select(RuStorePushToken).where(RuStorePushToken.token == token)
            )
        ).scalar_one()
        assert row.user_id == u1.id

    # Переустановка приложения/смена аккаунта: тот же токен приходит от другого
    # пользователя — владелец должен обновиться (push не утекают прошлому).
    r = await api.client.post(
        "/api/v1/push/rustore/subscribe/",
        json={"token": token},
        headers=api.auth(await api.token_for(u2)),
    )
    assert r.status_code == 200, r.text
    async with api.factory() as session:
        row = (
            await session.execute(
                select(RuStorePushToken).where(RuStorePushToken.token == token)
            )
        ).scalar_one()
        assert row.user_id == u2.id

    # Выход из аккаунта: токен снимается, повторный вызов идемпотентен.
    r = await api.client.post(
        "/api/v1/push/rustore/unsubscribe/", json={"token": token}
    )
    assert r.status_code == 200, r.text
    async with api.factory() as session:
        remaining = (
            await session.execute(
                select(RuStorePushToken).where(RuStorePushToken.token == token)
            )
        ).scalar_one_or_none()
        assert remaining is None


# --- Mute чата (серверный; без Web Push в замьюченный чат) ------------------


async def test_chat_mute_via_api(api: _ApiCtx) -> None:
    """Mute включается/снимается через API и отражается в списке /chats/."""
    u1 = await api.make_user()
    u2 = await api.make_user()
    u3 = await api.make_user()
    t1 = await api.token_for(u1)
    t2 = await api.token_for(u2)
    t3 = await api.token_for(u3)

    chat = await api.private_chat(t1, u2.id)
    chat_id = chat["id"]

    async def muted_flag(token: str) -> bool:
        r = await api.client.get("/api/v1/chats/", headers=api.auth(token))
        assert r.status_code == 200, r.text
        return next(c["muted"] for c in r.json() if c["id"] == chat_id)

    assert await muted_flag(t1) is False

    r = await api.client.put(f"/api/v1/chats/{chat_id}/mute/", headers=api.auth(t1))
    assert r.status_code == 200 and r.json()["muted"] is True
    assert await muted_flag(t1) is True
    # У собеседника mute не «протекает».
    assert await muted_flag(t2) is False

    r = await api.client.delete(f"/api/v1/chats/{chat_id}/mute/", headers=api.auth(t1))
    assert r.status_code == 200 and r.json()["muted"] is False
    assert await muted_flag(t1) is False

    # Не участник не может замьютить чужой чат.
    r = await api.client.put(f"/api/v1/chats/{chat_id}/mute/", headers=api.auth(t3))
    assert r.status_code == 404


async def test_muted_chat_skips_push_recipients(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """В замьюченный чат Web Push не планируется (realtime остаётся)."""
    u1 = await api.make_user()
    u2 = await api.make_user()
    t1 = await api.token_for(u1)
    t2 = await api.token_for(u2)

    chat = await api.private_chat(t1, u2.id)
    chat_id = chat["id"]

    captured: list[tuple[list[int], int, dict]] = []

    def fake_enqueue(recipients: list[int], chat_id: int, payload: dict) -> None:
        captured.append((list(recipients), chat_id, payload))

    monkeypatch.setattr(
        "api_v1.events.service._maybe_enqueue_message_push", fake_enqueue
    )

    # u2 замьютил чат → в получателях push его нет.
    r = await api.client.put(f"/api/v1/chats/{chat_id}/mute/", headers=api.auth(t2))
    assert r.status_code == 200
    await api.send(t1, chat_id, "привет в замьюченный чат")
    assert captured, "ожидали планирование push-рассылки"
    recipients, _, _ = captured[-1]
    assert u2.id not in recipients

    # После снятия mute — u2 снова в получателях push.
    r = await api.client.delete(f"/api/v1/chats/{chat_id}/mute/", headers=api.auth(t2))
    assert r.status_code == 200
    await api.send(t1, chat_id, "привет после анмута")
    recipients, _, _ = captured[-1]
    assert u2.id in recipients


# --- Групповые чаты -------------------------------------------------------


async def _create_group(
    api: _ApiCtx, token: str, name: str, user_ids: list[int]
) -> dict:
    """Создаёт группу и возвращает её карточку."""
    response = await api.client.post(
        "/api/v1/chats/groups/",
        json={"name": name, "user_ids": user_ids},
        headers=api.auth(token),
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _my_chats(api: _ApiCtx, token: str) -> list[dict]:
    response = await api.client.get("/api/v1/chats/", headers=api.auth(token))
    assert response.status_code == 200, response.text
    return response.json()


async def _chat_detail(api: _ApiCtx, token: str, chat_id: int) -> dict:
    response = await api.client.get(
        f"/api/v1/chats/{chat_id}/", headers=api.auth(token)
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_group_create_and_visible_to_members(
    api: _ApiCtx,
) -> None:
    """Создание группы: создатель, состав, видимость у всех участников."""
    u1 = await api.make_user()
    u2 = await api.make_user()
    u3 = await api.make_user()
    t1 = await api.token_for(u1)
    t2 = await api.token_for(u2)
    t3 = await api.token_for(u3)

    chat = await _create_group(api, t1, "Команда", [u2.id, u3.id])
    assert chat["is_group"] is True
    assert chat["my_role"] == "creator"
    assert chat["member_count"] == 3
    assert len(chat["users"]) == 3

    # Участники видят группу в своём списке.
    for token in (t2, t3):
        mine = await _my_chats(api, token)
        group = next((c for c in mine if c["id"] == chat["id"]), None)
        assert group is not None
        assert group["is_group"] is True
        assert group["my_role"] == "member"
        assert group["member_count"] == 3

    # Посторонний не видит группу.
    outsider = await api.make_user()
    mine = await _my_chats(api, await api.token_for(outsider))
    assert all(c["id"] != chat["id"] for c in mine)


async def test_group_detail_roles_and_update_permissions(
    api: _ApiCtx,
) -> None:
    """Карточка группы: роли; редактирование — только создатель/админ."""
    u1 = await api.make_user()
    u2 = await api.make_user()
    u3 = await api.make_user()
    t1 = await api.token_for(u1)
    t3 = await api.token_for(u3)

    chat = await _create_group(api, t1, "Чат", [u2.id, u3.id])
    detail = await _chat_detail(api, t1, chat["id"])
    assert len(detail["members"]) == 3
    roles = {m["id"]: m["role"] for m in detail["members"]}
    assert roles[u1.id] == "creator"
    assert roles[u2.id] == "member"

    # Обычный участник не может менять название.
    r = await api.client.patch(
        f"/api/v1/chats/{chat['id']}/",
        json={"name": "Нельзя"},
        headers=api.auth(t3),
    )
    assert r.status_code == 403

    # Создатель меняет название и описание.
    r = await api.client.patch(
        f"/api/v1/chats/{chat['id']}/",
        json={"name": "Новое имя", "description": "Описание группы"},
        headers=api.auth(t1),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "Новое имя"
    assert body["description"] == "Описание группы"


async def test_group_add_remove_promote(api: _ApiCtx) -> None:
    """Управление составом: добавление, исключение, назначение админа."""
    u1 = await api.make_user()
    u2 = await api.make_user()
    u3 = await api.make_user()
    u4 = await api.make_user()
    t1 = await api.token_for(u1)
    t2 = await api.token_for(u2)
    t3 = await api.token_for(u3)

    chat = await _create_group(api, t1, "Группа", [u2.id])

    # Создатель добавляет u3.
    r = await api.client.post(
        f"/api/v1/chats/{chat['id']}/members/",
        json={"user_ids": [u3.id]},
        headers=api.auth(t1),
    )
    assert r.status_code == 200, r.text
    assert r.json()["member_count"] == 3
    # Добавленный участник (u3) видит группу в своём списке.
    mine = await _my_chats(api, t3)
    assert any(c["id"] == chat["id"] for c in mine)

    # Обычный участник (u2) не может добавлять.
    r = await api.client.post(
        f"/api/v1/chats/{chat['id']}/members/",
        json={"user_ids": [u4.id]},
        headers=api.auth(t2),
    )
    assert r.status_code == 403

    # Создатель назначает u2 админом.
    r = await api.client.patch(
        f"/api/v1/chats/{chat['id']}/members/{u2.id}/role/",
        json={"role": "admin"},
        headers=api.auth(t1),
    )
    assert r.status_code == 204
    detail = await _chat_detail(api, t1, chat["id"])
    roles = {m["id"]: m["role"] for m in detail["members"]}
    assert roles[u2.id] == "admin"

    # Админ исключает обычного участника u3.
    r = await api.client.delete(
        f"/api/v1/chats/{chat['id']}/members/{u3.id}/",
        headers=api.auth(t2),
    )
    assert r.status_code == 204
    detail = await _chat_detail(api, t1, chat["id"])
    member_ids = {m["id"] for m in detail["members"]}
    assert u3.id not in member_ids
    # Исключённый больше не видит группу в списке.
    mine = await _my_chats(api, t3)
    assert all(c["id"] != chat["id"] for c in mine)

    # Админ не может исключить создателя.
    r = await api.client.delete(
        f"/api/v1/chats/{chat['id']}/members/{u1.id}/",
        headers=api.auth(t2),
    )
    assert r.status_code == 400


async def test_group_send_unread_and_read(api: _ApiCtx) -> None:
    """Групповые сообщения и счётчик непрочитанных по курсору участника."""
    u1 = await api.make_user()
    u2 = await api.make_user()
    t1 = await api.token_for(u1)
    t2 = await api.token_for(u2)

    chat = await _create_group(api, t1, "Рассылка", [u2.id])

    await api.send(t1, chat["id"], "всем привет")
    mine = await _my_chats(api, t2)
    group = next(c for c in mine if c["id"] == chat["id"])
    assert group["unread_count"] == 1

    # Чтение истории участником сбрасывает его курсор.
    msgs = await api.list_messages(t2, chat["id"])
    assert len(msgs) == 1
    mine = await _my_chats(api, t2)
    group = next(c for c in mine if c["id"] == chat["id"])
    assert group["unread_count"] == 0
    # У автора никогда не было непрочитанных.
    mine = await _my_chats(api, t1)
    group = next(c for c in mine if c["id"] == chat["id"])
    assert group["unread_count"] == 0


async def test_group_leave_and_delete_rules(api: _ApiCtx) -> None:
    """Выход из группы и удаление группы — только создатель удаляет целиком."""
    u1 = await api.make_user()
    u2 = await api.make_user()
    u3 = await api.make_user()
    t1 = await api.token_for(u1)
    t2 = await api.token_for(u2)
    t3 = await api.token_for(u3)

    chat = await _create_group(api, t1, "Общая", [u2.id, u3.id])

    # Создатель не может «выйти» при наличии участников.
    r = await api.client.delete(f"/api/v1/chats/{chat['id']}/", headers=api.auth(t1))
    assert r.status_code == 400

    # Участник выходит — состав обновляется, чат остаётся.
    r = await api.client.delete(f"/api/v1/chats/{chat['id']}/", headers=api.auth(t3))
    assert r.status_code == 204
    detail = await _chat_detail(api, t1, chat["id"])
    member_ids = {m["id"] for m in detail["members"]}
    assert u3.id not in member_ids and u2.id in member_ids

    # Обычный участник не может удалить группу «для всех».
    r = await api.client.delete(
        f"/api/v1/chats/{chat['id']}/",
        params={"for_all": "true"},
        headers=api.auth(t2),
    )
    assert r.status_code == 403

    # Создатель удаляет группу целиком → остальные получают 404.
    r = await api.client.delete(
        f"/api/v1/chats/{chat['id']}/",
        params={"for_all": "true"},
        headers=api.auth(t1),
    )
    assert r.status_code == 204
    r = await api.client.get(f"/api/v1/chats/{chat['id']}/", headers=api.auth(t2))
    assert r.status_code == 404


# --- Модерация: блокировка и жалобы (требования RuStore для UGC) -----------


async def test_block_user_blocks_messages_and_hides_chat(api: _ApiCtx) -> None:
    """Блокировка: чат скрыт у блокирующего, сообщения запрещены в обе стороны."""
    u1 = await api.make_user()
    u2 = await api.make_user()
    t1 = await api.token_for(u1)
    t2 = await api.token_for(u2)
    chat = await api.private_chat(t1, u2.id)

    # До блокировки сообщение проходит.
    r = await api.client.post(
        "/api/v1/messages/",
        json={"chat_id": chat["id"], "text": "до блокировки"},
        headers=api.auth(t2),
    )
    assert r.status_code == 200, r.text

    # u1 блокирует u2.
    r = await api.client.put(
        f"/api/v1/moderation/blocks/{u2.id}/", headers=api.auth(t1)
    )
    assert r.status_code == 200, r.text
    assert r.json()["blocked"] is True

    # Чат скрыт у блокирующего, но остаётся у собеседника.
    chats1 = (await api.client.get("/api/v1/chats/", headers=api.auth(t1))).json()
    chats2 = (await api.client.get("/api/v1/chats/", headers=api.auth(t2))).json()
    assert all(c["id"] != chat["id"] for c in chats1)
    assert any(c["id"] == chat["id"] for c in chats2)

    # Сообщения не проходят в обе стороны.
    for token in (t1, t2):
        r = await api.client.post(
            "/api/v1/messages/",
            json={"chat_id": chat["id"], "text": "после блокировки"},
            headers=api.auth(token),
        )
        assert r.status_code == 403, r.text

    # Список заблокированных → снятие блокировки возвращает чат и переписку.
    blocked = (
        await api.client.get("/api/v1/moderation/blocks/", headers=api.auth(t1))
    ).json()
    assert [item["id"] for item in blocked] == [u2.id]

    r = await api.client.delete(
        f"/api/v1/moderation/blocks/{u2.id}/", headers=api.auth(t1)
    )
    assert r.status_code == 200
    assert r.json()["blocked"] is False
    chats1 = (await api.client.get("/api/v1/chats/", headers=api.auth(t1))).json()
    assert any(c["id"] == chat["id"] for c in chats1)
    r = await api.client.post(
        "/api/v1/messages/",
        json={"chat_id": chat["id"], "text": "после разблокировки"},
        headers=api.auth(t2),
    )
    assert r.status_code == 200, r.text


async def test_block_validation(api: _ApiCtx) -> None:
    """Нельзя заблокировать себя; чужой аккаунт — 404; без токена — 401."""
    u1 = await api.make_user()
    t1 = await api.token_for(u1)

    r = await api.client.put(
        f"/api/v1/moderation/blocks/{u1.id}/", headers=api.auth(t1)
    )
    assert r.status_code == 400
    r = await api.client.put(
        "/api/v1/moderation/blocks/99999999/", headers=api.auth(t1)
    )
    assert r.status_code == 404
    r = await api.client.put("/api/v1/moderation/blocks/1/")
    assert r.status_code == 401


async def test_report_user(api: _ApiCtx) -> None:
    """Жалоба: причина обязательна, на себя нельзя, чужое сообщение — 403."""
    from sqlalchemy import select

    from core.models import UserReport

    u1 = await api.make_user()
    u2 = await api.make_user()
    u3 = await api.make_user()
    t1 = await api.token_for(u1)
    t2 = await api.token_for(u2)
    t3 = await api.token_for(u3)
    chat = await api.private_chat(t2, u1.id)
    sent = await api.client.post(
        "/api/v1/messages/",
        json={"chat_id": chat["id"], "text": "спам-сообщение"},
        headers=api.auth(t2),
    )
    message_id = sent.json()["id"]

    # Причина обязательна (валидация схемы).
    r = await api.client.post(
        "/api/v1/moderation/reports/",
        json={"user_id": u2.id},
        headers=api.auth(t1),
    )
    assert r.status_code == 422

    # На себя — 400, несуществующий — 404.
    r = await api.client.post(
        "/api/v1/moderation/reports/",
        json={"user_id": u1.id, "reason": "spam"},
        headers=api.auth(t1),
    )
    assert r.status_code == 400
    r = await api.client.post(
        "/api/v1/moderation/reports/",
        json={"user_id": 99999999, "reason": "spam"},
        headers=api.auth(t1),
    )
    assert r.status_code == 404

    # Жалоба на сообщение в своём чате.
    r = await api.client.post(
        "/api/v1/moderation/reports/",
        json={
            "user_id": u2.id,
            "reason": "spam",
            "comment": "реклама",
            "message_id": message_id,
        },
        headers=api.auth(t1),
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "new"

    # Жалоба «на пользователя» из открытого диалога: контекст чата сохраняется.
    r = await api.client.post(
        "/api/v1/moderation/reports/",
        json={"user_id": u2.id, "reason": "fraud", "chat_id": chat["id"]},
        headers=api.auth(t1),
    )
    assert r.status_code == 201, r.text
    async with api.factory() as session:
        reports = (
            (
                await session.execute(
                    select(UserReport)
                    .where(UserReport.reporter_id == u1.id)
                    .order_by(UserReport.id)
                )
            )
            .scalars()
            .all()
        )
        assert [rep.chat_id for rep in reports] == [chat["id"], chat["id"]]
        assert [rep.message_id for rep in reports] == [message_id, None]

    # Чужой чат (u1 и u3 не общаются) — контекст не подтверждается: 403.
    other = await api.private_chat(t2, u3.id)
    r = await api.client.post(
        "/api/v1/moderation/reports/",
        json={"user_id": u2.id, "reason": "spam", "chat_id": other["id"]},
        headers=api.auth(t1),
    )
    assert r.status_code == 403

    # Посторонний на чужое сообщение пожаловаться не может.
    r = await api.client.post(
        "/api/v1/moderation/reports/",
        json={"user_id": u2.id, "reason": "spam", "message_id": message_id},
        headers=api.auth(t3),
    )
    assert r.status_code == 403

    # Без авторизации — 401.
    r = await api.client.post(
        "/api/v1/moderation/reports/", json={"user_id": u2.id, "reason": "spam"}
    )
    assert r.status_code == 401


async def test_delete_account(api: _ApiCtx) -> None:
    """Удаление аккаунта: подтверждение + пароль, данные и доступ исчезают."""
    from sqlalchemy import select

    from core.models import Message
    from core.security import get_password_hash

    user = await api.make_user()
    async with api.factory() as session:
        row = await session.get(User, user.id)
        assert row is not None
        row.hashed_password = get_password_hash("secret")
        row.password_set = True
        await session.commit()

    token = await api.token_for(user)
    peer = await api.make_user()
    peer_token = await api.token_for(peer)
    chat = await api.private_chat(peer_token, user.id)
    await api.client.post(
        "/api/v1/messages/",
        json={"chat_id": chat["id"], "text": "моё сообщение"},
        headers=api.auth(token),
    )

    # Подтверждение обязательно, пароль проверяется.
    r = await api.client.request(
        "DELETE",
        "/api/v1/users/me/",
        json={"confirm": "нет", "password": "secret"},
        headers=api.auth(token),
    )
    assert r.status_code == 400
    r = await api.client.request(
        "DELETE",
        "/api/v1/users/me/",
        json={"confirm": "УДАЛИТЬ", "password": "неверный"},
        headers=api.auth(token),
    )
    assert r.status_code == 403

    # Успешное удаление.
    r = await api.client.request(
        "DELETE",
        "/api/v1/users/me/",
        json={"confirm": "УДАЛИТЬ", "password": "secret"},
        headers=api.auth(token),
    )
    assert r.status_code == 204, r.text

    async with api.factory() as session:
        assert await session.get(User, user.id) is None
        rest = (
            (
                await session.execute(
                    select(Message).where(Message.chat_id == chat["id"])
                )
            )
            .scalars()
            .all()
        )
        assert all(message.user_id != user.id for message in rest)

    # Токен удалённого аккаунта больше не работает.
    r = await api.client.get("/api/v1/jwt/users/me/", headers=api.auth(token))
    assert r.status_code == 401


# --- Разбор жалоб модератором (только is_superuser) -----------------------


async def _make_admin(api: _ApiCtx) -> tuple[User, str]:
    """Создаёт суперпользователя и возвращает его вместе с токеном."""
    admin = await api.make_user()
    async with api.factory() as session:
        row = await session.get(User, admin.id)
        assert row is not None
        row.is_superuser = True
        await session.commit()
    return admin, await api.token_for(admin)


async def test_reports_admin_list_and_update(api: _ApiCtx) -> None:
    """Админ видит жалобы с контекстом и меняет статус разбора."""
    u1 = await api.make_user()
    u2 = await api.make_user()
    admin, tadmin = await _make_admin(api)
    t1 = await api.token_for(u1)

    chat = await api.private_chat(t1, u2.id)
    created = await api.client.post(
        "/api/v1/moderation/reports/",
        json={
            "user_id": u2.id,
            "reason": "abuse",
            "comment": "ругань в переписке",
            "chat_id": chat["id"],
        },
        headers=api.auth(t1),
    )
    assert created.status_code == 201, created.text
    report_id = created.json()["id"]

    response = await api.client.get(
        "/api/v1/moderation/reports/?status=new", headers=api.auth(tadmin)
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["total"] == 1
    item = data["items"][0]
    assert item["id"] == report_id
    assert (item["reporter_id"], item["reported_id"]) == (u1.id, u2.id)
    assert item["reason"] == "abuse"
    assert item["comment"] == "ругань в переписке"
    assert item["chat_id"] == chat["id"]
    assert item["message_id"] is None
    # Имена/телефоны для модератора + жалоба ещё не разобрана.
    assert item["reporter_name"] == u1.username
    assert item["reported_phone"] == u2.phone_number
    assert item["status"] == "new"
    assert item["reviewed_at"] is None
    assert item["created_at"]

    # Фильтры по статусу и причине.
    assert (
        await api.client.get(
            "/api/v1/moderation/reports/?status=resolved",
            headers=api.auth(tadmin),
        )
    ).json()["total"] == 0
    assert (
        await api.client.get(
            "/api/v1/moderation/reports/?reason=spam", headers=api.auth(tadmin)
        )
    ).json()["total"] == 0

    # Разбор: статус + заметка, reviewed_at проставляется.
    updated = await api.client.patch(
        f"/api/v1/moderation/reports/{report_id}/",
        json={"status": "resolved", "note": "предупредили пользователя"},
        headers=api.auth(tadmin),
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["status"] == "resolved"
    assert body["note"] == "предупредили пользователя"
    assert body["reviewed_at"]

    # Жалоба ушла из «новых» в «решённые».
    assert (
        await api.client.get(
            "/api/v1/moderation/reports/?status=new", headers=api.auth(tadmin)
        )
    ).json()["total"] == 0
    assert (
        await api.client.get(
            "/api/v1/moderation/reports/?status=resolved",
            headers=api.auth(tadmin),
        )
    ).json()["total"] == 1

    # Возврат в «new» сбрасывает метку разбора, заметка сохраняется.
    back = await api.client.patch(
        f"/api/v1/moderation/reports/{report_id}/",
        json={"status": "new"},
        headers=api.auth(tadmin),
    )
    assert back.json()["reviewed_at"] is None
    assert back.json()["note"] == "предупредили пользователя"

    # Невалидный статус — 422, несуществующая жалоба — 404.
    assert (
        await api.client.patch(
            f"/api/v1/moderation/reports/{report_id}/",
            json={"status": "нет"},
            headers=api.auth(tadmin),
        )
    ).status_code == 422
    assert (
        await api.client.patch(
            "/api/v1/moderation/reports/99999999/",
            json={"status": "rejected"},
            headers=api.auth(tadmin),
        )
    ).status_code == 404


async def test_reports_admin_only(api: _ApiCtx) -> None:
    """Список/разбор жалоб закрыт: обычный пользователь — 403, гость — 401."""
    u1 = await api.make_user()
    t1 = await api.token_for(u1)

    assert (
        await api.client.get("/api/v1/moderation/reports/", headers=api.auth(t1))
    ).status_code == 403
    assert (
        await api.client.patch(
            "/api/v1/moderation/reports/1/",
            json={"status": "resolved"},
            headers=api.auth(t1),
        )
    ).status_code == 403
    assert (await api.client.get("/api/v1/moderation/reports/")).status_code == 401


async def test_reports_pagination(api: _ApiCtx) -> None:
    """Пагинация: limit/offset с общим количеством в total."""
    u1 = await api.make_user()
    u2 = await api.make_user()
    _admin, tadmin = await _make_admin(api)
    t1, t2 = await api.token_for(u1), await api.token_for(u2)

    for _ in range(3):
        r = await api.client.post(
            "/api/v1/moderation/reports/",
            json={"user_id": u2.id, "reason": "spam"},
            headers=api.auth(t1),
        )
        assert r.status_code == 201, r.text
    r = await api.client.post(
        "/api/v1/moderation/reports/",
        json={"user_id": u1.id, "reason": "other"},
        headers=api.auth(t2),
    )
    assert r.status_code == 201, r.text

    page = (
        await api.client.get(
            "/api/v1/moderation/reports/?limit=2&offset=0",
            headers=api.auth(tadmin),
        )
    ).json()
    assert page["total"] == 4
    assert len(page["items"]) == 2
    # Свежие первыми.
    assert page["items"][0]["reason"] == "other"

    second = (
        await api.client.get(
            "/api/v1/moderation/reports/?limit=2&offset=2",
            headers=api.auth(tadmin),
        )
    ).json()
    assert second["total"] == 4
    assert len(second["items"]) == 2
    assert not {i["id"] for i in page["items"]} & {i["id"] for i in second["items"]}

    # Лимит за пределами допустимого/отрицательный offset — 422.
    assert (
        await api.client.get(
            "/api/v1/moderation/reports/?limit=0", headers=api.auth(tadmin)
        )
    ).status_code == 422
    assert (
        await api.client.get(
            "/api/v1/moderation/reports/?offset=-1", headers=api.auth(tadmin)
        )
    ).status_code == 422


# --- Пароль задаётся после OTP, номер телефона неизменяем ------------------


async def test_set_password_after_otp_login(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """OTP-вход → задаём пароль → дальше вход по паролю (код больше не нужен)."""
    phone = _random_phone()
    code = await _request_otp(api, monkeypatch, phone)
    verify = await api.client.post(
        "/api/v1/auth/verify-otp/",
        json={"phone_number": phone, "otp": code},
    )
    assert verify.status_code == 200, verify.text
    token = verify.json()["access_token"]

    # Сразу после OTP пароля нет — статус это подтверждает (и сообщает, есть ли
    # вообще канал доставки кодов).
    status = (
        await api.client.post(
            "/api/v1/auth/password/status/", json={"phone_number": phone}
        )
    ).json()
    assert status["registered"] is True
    assert status["has_password"] is False
    assert "otp_available" in status

    # Задаём пароль без current_password: его ещё нет.
    first = await api.client.post(
        "/api/v1/auth/password/set/",
        json={"password": "newpass123"},
        headers=api.auth(token),
    )
    assert first.status_code == 200, first.text

    login = await api.client.post(
        "/api/v1/auth/password/login/",
        json={"phone_number": phone, "password": "newpass123"},
    )
    assert login.status_code == 200, login.text

    # Смена пароля: неверный текущий → 400, верный → 200 и старый не работает.
    bad = await api.client.post(
        "/api/v1/auth/password/set/",
        json={"password": "another123", "current_password": "wrong-one"},
        headers=api.auth(token),
    )
    assert bad.status_code == 400
    good = await api.client.post(
        "/api/v1/auth/password/set/",
        json={"password": "another123", "current_password": "newpass123"},
        headers=api.auth(token),
    )
    assert good.status_code == 200, good.text
    assert (
        await api.client.post(
            "/api/v1/auth/password/login/",
            json={"phone_number": phone, "password": "another123"},
        )
    ).status_code == 200
    assert (
        await api.client.post(
            "/api/v1/auth/password/login/",
            json={"phone_number": phone, "password": "newpass123"},
        )
    ).status_code == 401

    # Короткий пароль — 400, без авторизации — 401.
    assert (
        await api.client.post(
            "/api/v1/auth/password/set/",
            json={"password": "123"},
            headers=api.auth(token),
        )
    ).status_code == 400
    assert (
        await api.client.post(
            "/api/v1/auth/password/set/", json={"password": "whatever123"}
        )
    ).status_code == 401


async def test_profile_phone_cannot_be_changed(api: _ApiCtx) -> None:
    """Номер телефона — логин аккаунта: через профиль его передать нельзя."""
    phone = _random_phone()
    user = await api.make_user(phone_number=phone)
    token = await api.token_for(user)

    # Любая попытка передать номер → 422 (даже с тем же значением).
    rejected = await api.client.patch(
        "/api/v1/jwt/users/me/",
        json={"phone_number": "+79001112233"},
        headers=api.auth(token),
    )
    assert rejected.status_code == 422, rejected.text

    # Остальные поля меняются, номер остаётся прежним.
    updated = await api.client.patch(
        "/api/v1/jwt/users/me/",
        json={"first_name": "Никита", "status": "тест профиля"},
        headers=api.auth(token),
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["first_name"] == "Никита"
    assert body["status"] == "тест профиля"
    assert body["phone_number"] == phone

    async with api.factory() as session:
        stored = await session.get(User, user.id)
        assert stored is not None
        assert stored.phone_number == phone
