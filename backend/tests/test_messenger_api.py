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

from core.config import settings
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


async def test_otp_daily_limit_blocks_sending(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Дневной лимит кодов защищает баланс шлюза: дальше 429 и без отправки.

    Каждый код стоит денег, поэтому при исчерпании лимита запросы отклоняются
    до постановки задачи в очередь (то есть до траты денег).
    """
    monkeypatch.setattr(settings, "auth_otp_resend_cooldown_seconds", 0)
    monkeypatch.setattr(settings, "auth_otp_daily_limit", 1)
    sent: list[str] = []
    monkeypatch.setattr(
        "api_v1.auth.views.enqueue_sms_otp",
        lambda phone_number, otp_code: sent.append(phone_number),
    )

    first = await api.client.post(
        "/api/v1/auth/request-otp/",
        json={"phone_number": _random_phone()},
    )
    assert first.status_code == 200, first.text

    second = await api.client.post(
        "/api/v1/auth/request-otp/",
        json={"phone_number": _random_phone()},
    )
    assert second.status_code == 429, second.text
    assert "дневной лимит" in second.json()["detail"]
    # Денег не потратили: вторая задача даже не поставлена.
    assert len(sent) == 1


async def test_otp_daily_limit_per_ip(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Лимит на IP не даёт одному источнику перебирать номера за счёт сервиса."""
    monkeypatch.setattr(settings, "auth_otp_resend_cooldown_seconds", 0)
    monkeypatch.setattr(settings, "auth_otp_daily_limit", 10)
    monkeypatch.setattr(settings, "auth_otp_per_ip_daily_limit", 1)
    monkeypatch.setattr("api_v1.auth.views.enqueue_sms_otp", lambda p, c: None)

    first = await api.client.post(
        "/api/v1/auth/request-otp/",
        json={"phone_number": _random_phone()},
    )
    assert first.status_code == 200, first.text

    second = await api.client.post(
        "/api/v1/auth/request-otp/",
        json={"phone_number": _random_phone()},
    )
    assert second.status_code == 429, second.text
    assert "адреса" in second.json()["detail"]


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


# --- Ссылка-профиль (/u/<логин>) -------------------------------------------


async def test_user_link_lookup_via_api(api: _ApiCtx) -> None:
    """По ссылке-профилю логин находит человека и отдаёт только публичные поля."""
    me = await api.make_user()
    peer = await api.make_user(username="link_target_1")
    token = await api.token_for(me)

    response = await api.client.get(
        "/api/v1/users/by-username/link_target_1",
        headers=api.auth(token),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == peer.id
    assert body["username"] == "link_target_1"
    # Номер телефона по ссылке не раскрываем (ссылку можно переслать кому угодно).
    assert "phone_number" not in body

    # Регистр логина не важен, ведущая «@» игнорируется.
    for variant in ("Link_Target_1", "@link_target_1"):
        variant_resp = await api.client.get(
            f"/api/v1/users/by-username/{variant}",
            headers=api.auth(token),
        )
        assert variant_resp.status_code == 200, variant_resp.text
        assert variant_resp.json()["id"] == peer.id

    # Неизвестный логин — 404; без токена — 401 (ссылка не публичный эндпоинт).
    missing = await api.client.get(
        "/api/v1/users/by-username/nobody_here_at_all",
        headers=api.auth(token),
    )
    assert missing.status_code == 404

    anonymous = await api.client.get("/api/v1/users/by-username/link_target_1")
    assert anonymous.status_code == 401


# --- Предпросмотр внешних ссылок -------------------------------------------


async def test_link_preview_via_api(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Карточка внешней ссылки собирается один раз и дальше берётся из кэша.

    Хождение в интернет подменено: тест не должен зависеть от доступности
    YouTube и не должен «дёргать» чужие сайты из CI.
    """
    from api_v1.link_previews import views as link_views
    from core.link_preview import LinkPreviewData

    me = await api.make_user()
    token = await api.token_for(me)
    calls: list[str] = []

    def fake_fetch(url: str, **kwargs: object) -> LinkPreviewData:
        calls.append(url)
        return LinkPreviewData(
            url=url,
            title="Видео на YouTube",
            description="Описание видео",
            site_name="YouTube",
            image_url="https://i.ytimg.com/vi/SOi0APxsdgE/hqdefault.jpg",
        )

    def fake_image(url: str, **kwargs: object) -> None:
        # Картинку «скачать» не удалось — карточка должна остаться без неё.
        return None

    monkeypatch.setattr(link_views, "fetch_preview", fake_fetch)
    monkeypatch.setattr(link_views, "fetch_preview_image", fake_image)
    # Кэш надолго, чтобы второй запрос точно взял строку из БД.
    monkeypatch.setattr(link_views.settings, "link_preview_cache_hours", 24)

    # Фрагмент (#...) в кэш не попадает: адрес нормализуется.
    payload = {"url": "https://www.youtube.com/watch?v=SOi0APxsdgE&t=30#frag"}
    first = await api.client.post(
        "/api/v1/link-preview/", json=payload, headers=api.auth(token)
    )
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["ok"] is True
    assert body["title"] == "Видео на YouTube"
    assert body["description"] == "Описание видео"
    assert body["site_name"] == "YouTube"
    assert body["domain"] == "youtube.com"
    assert body["image_url"] is None
    assert body["url"] == "https://www.youtube.com/watch?v=SOi0APxsdgE&t=30"

    second = await api.client.post(
        "/api/v1/link-preview/", json=payload, headers=api.auth(token)
    )
    assert second.status_code == 200, second.text
    assert second.json()["title"] == "Видео на YouTube"
    # Обращение к сайту было ровно одно — второй раз отдал кэш.
    assert calls == ["https://www.youtube.com/watch?v=SOi0APxsdgE&t=30"]

    # Сайт недоступен: ответ всё равно успешный (клиент просто не покажет карточку).
    monkeypatch.setattr(link_views, "fetch_preview", lambda url, **kwargs: None)
    failed = await api.client.post(
        "/api/v1/link-preview/",
        json={"url": "https://unreachable.example/page"},
        headers=api.auth(token),
    )
    assert failed.status_code == 200, failed.text
    assert failed.json()["ok"] is False
    assert failed.json()["title"] is None

    # Не ссылка — 400; без токена — 401.
    invalid = await api.client.post(
        "/api/v1/link-preview/",
        json={"url": "ftp://example.com/file"},
        headers=api.auth(token),
    )
    assert invalid.status_code == 400

    anonymous = await api.client.post(
        "/api/v1/link-preview/", json={"url": "https://example.com/"}
    )
    assert anonymous.status_code == 401


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
    # Смена пароля гасит ВСЕ прежние access-токены (эпоха доступа поднялась),
    # поэтому дальше работаем токеном из ответа — как это делает приложение.
    assert first.json()["access_token"]
    old_token = token
    token = first.json()["access_token"]
    stale = await api.client.get("/api/v1/auth/sessions/", headers=api.auth(old_token))
    assert stale.status_code == 401, stale.text
    assert stale.json()["detail"]["code"] == "session_revoked"

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
    # Каждая смена пароля гасит прежние токены — берём свежий из ответа.
    token = good.json()["access_token"]
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


# --- Безопасность входа: политика пароля, блокировка, отзыв сессий ---------

_STRONG_PASSWORD = "vesna-listopad-42"


async def _account_with_password(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch, password: str = _STRONG_PASSWORD
) -> tuple[str, str]:
    """Заводит аккаунт по коду и задаёт ему пароль; возвращает (номер, access)."""
    phone = _random_phone()
    await _request_otp(api, monkeypatch, phone)
    response = await api.client.post(
        "/api/v1/auth/password/register/",
        json={"phone_number": phone, "password": password},
    )
    assert response.status_code == 200, response.text
    return phone, response.json()["access_token"]


@pytest.mark.parametrize(
    "password",
    ["korova", "1234567890", "qwertyuiop", "korova1111moloko"],
)
async def test_weak_password_rejected_on_register(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch, password: str
) -> None:
    """Слабый пароль не принимаем и объясняем причину (400 с текстом политики)."""
    monkeypatch.setattr("api_v1.auth.views.enqueue_sms_otp", lambda p, c: None)
    phone = _random_phone()

    response = await api.client.post(
        "/api/v1/auth/password/register/",
        json={"phone_number": phone, "password": password},
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"]


async def test_password_login_locks_account_after_failures(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Перебор пароля блокирует аккаунт (лимит по IP обходится сменой адреса)."""
    phone, _ = await _account_with_password(api, monkeypatch)
    limit = settings.auth_login_max_failures

    for _ in range(limit):
        wrong = await api.client.post(
            "/api/v1/auth/password/login/",
            json={"phone_number": phone, "password": "vesna-listopad-99"},
        )
        assert wrong.status_code == 401, wrong.text

    # Следующая попытка — уже с блокировкой, даже с верным паролем.
    locked = await api.client.post(
        "/api/v1/auth/password/login/",
        json={"phone_number": phone, "password": _STRONG_PASSWORD},
    )
    assert locked.status_code == 429, locked.text
    assert int(locked.headers["Retry-After"]) > 0


async def test_password_login_success_resets_failures(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Успешный вход обнуляет счётчик неудач — аккаунт не «накапливает» блокировку."""
    phone, _ = await _account_with_password(api, monkeypatch)

    for _ in range(settings.auth_login_max_failures - 2):
        wrong = await api.client.post(
            "/api/v1/auth/password/login/",
            json={"phone_number": phone, "password": "vesna-listopad-99"},
        )
        assert wrong.status_code == 401

    good = await api.client.post(
        "/api/v1/auth/password/login/",
        json={"phone_number": phone, "password": _STRONG_PASSWORD},
    )
    assert good.status_code == 200, good.text

    # После сброса счётчика те же неудачи снова не блокируют вход.
    for _ in range(settings.auth_login_max_failures - 2):
        wrong = await api.client.post(
            "/api/v1/auth/password/login/",
            json={"phone_number": phone, "password": "vesna-listopad-99"},
        )
        assert wrong.status_code == 401, wrong.text


async def test_password_login_marks_weak_legacy_password(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Слабый пароль (заданный до политики) помечается флагом при входе.

    Иначе сломали бы вход тем, у кого пароль уже есть: политика применяется
    только к новым паролям, а старый — помечается и фронт предлагает сменить.
    """
    phone = _random_phone()
    user = await api.make_user(phone_number=phone)
    from core.security import get_password_hash

    async with api.factory() as session:
        stored = await session.get(User, user.id)
        assert stored is not None
        stored.hashed_password = get_password_hash("kisa123")
        stored.password_set = True
        await session.commit()

    login = await api.client.post(
        "/api/v1/auth/password/login/",
        json={"phone_number": phone, "password": "kisa123"},
    )
    assert login.status_code == 200, login.text

    me = await api.client.get(
        "/api/v1/jwt/users/me/", headers=api.auth(login.json()["access_token"])
    )
    assert me.status_code == 200, me.text
    body = me.json()
    assert body["password_set"] is True
    assert body["password_weak"] is True


async def test_password_change_returns_tokens_and_adds_new_session(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Смена пароля требует текущий пароль, выдаёт новые токены и ставит флаг снятым."""
    phone, access = await _account_with_password(api, monkeypatch)

    wrong_current = await api.client.post(
        "/api/v1/auth/password/set/",
        json={"password": "moloko-korova-77", "current_password": "no-such-pass"},
        headers=api.auth(access),
    )
    assert wrong_current.status_code == 400, wrong_current.text

    changed = await api.client.post(
        "/api/v1/auth/password/set/",
        json={"password": "moloko-korova-77", "current_password": _STRONG_PASSWORD},
        headers=api.auth(access),
    )
    assert changed.status_code == 200, changed.text
    body = changed.json()
    # Пароль сменили из-за подозрения на взлом — старые сессии отозваны,
    # текущему устройству выдан новый комплект.
    assert body["access_token"] and body["refresh_token"]

    me = await api.client.get(
        "/api/v1/jwt/users/me/", headers=api.auth(body["access_token"])
    )
    assert me.json()["password_weak"] is False


async def test_password_change_revokes_other_refresh_sessions(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Смена пароля убивает refresh-сессии других устройств."""
    phone, access = await _account_with_password(api, monkeypatch)

    # «Другое устройство»: вход по паролю → своя refresh-сессия.
    other = await api.client.post(
        "/api/v1/auth/password/login/",
        json={"phone_number": phone, "password": _STRONG_PASSWORD},
    )
    assert other.status_code == 200, other.text
    other_refresh = other.json()["refresh_token"]

    changed = await api.client.post(
        "/api/v1/auth/password/set/",
        json={"password": "moloko-korova-77", "current_password": _STRONG_PASSWORD},
        headers=api.auth(access),
    )
    assert changed.status_code == 200, changed.text

    # Порядок важен: сначала проверяем свежий refresh, потому что попытка
    # использовать отозванный токен включает «семейный отзыв» (защита от кражи)
    # и убивает вообще все сессии, включая только что выданную.
    fresh = await api.client.post(
        "/api/v1/jwt/auth/refresh",
        headers={"Authorization": f"Bearer {changed.json()['refresh_token']}"},
    )
    assert fresh.status_code == 200, fresh.text

    revoked = await api.client.post(
        "/api/v1/jwt/auth/refresh",
        headers={"Authorization": f"Bearer {other_refresh}"},
    )
    assert revoked.status_code == 401, revoked.text


async def test_revoke_all_sessions_endpoint(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """«Выйти на всех устройствах» отзывает все refresh-сессии пользователя."""
    phone, access = await _account_with_password(api, monkeypatch)
    other = await api.client.post(
        "/api/v1/auth/password/login/",
        json={"phone_number": phone, "password": _STRONG_PASSWORD},
    )
    other_refresh = other.json()["refresh_token"]

    revoked = await api.client.post(
        "/api/v1/auth/sessions/revoke-all/", headers=api.auth(access)
    )
    assert revoked.status_code == 200, revoked.text
    assert "всех устройствах" in revoked.json()["detail"]

    after = await api.client.post(
        "/api/v1/jwt/auth/refresh",
        headers={"Authorization": f"Bearer {other_refresh}"},
    )
    assert after.status_code == 401, after.text


# --- E-mail-канал: подтверждение адреса, вход по коду, сброс пароля --------


@pytest.fixture
def email_channel(monkeypatch: pytest.MonkeyPatch):
    """Включает e-mail-канал и перехватывает письма (возвращает список кодов)."""
    sent: list[tuple[str, str]] = []

    def _fake_enqueue(email: str, code: str, subject: str, body: str) -> None:
        sent.append((email, code))

    monkeypatch.setattr("api_v1.auth.views.enqueue_email_code", _fake_enqueue)
    monkeypatch.setattr("api_v1.auth.views.email_otp_available", lambda: True)
    return sent


async def test_email_verification_flow(
    api: _ApiCtx, email_channel: list[tuple[str, str]]
) -> None:
    """Адрес привязывается только после кода из письма."""
    user = await api.make_user(phone_number=_random_phone())
    token = await api.token_for(user)
    address = f"user{uuid.uuid4().hex[:8]}@example.com"

    requested = await api.client.post(
        "/api/v1/auth/email/request-verification/",
        json={"email": address},
        headers=api.auth(token),
    )
    assert requested.status_code == 200, requested.text
    assert email_channel and email_channel[-1][0] == address
    code = email_channel[-1][1]

    # До подтверждения адрес не привязан и не считается подтверждённым.
    me = await api.client.get("/api/v1/jwt/users/me/", headers=api.auth(token))
    assert me.json()["email_verified"] is False

    wrong = await api.client.post(
        "/api/v1/auth/email/confirm-verification/",
        json={"email": address, "code": "000000"},
        headers=api.auth(token),
    )
    assert wrong.status_code == 401, wrong.text

    confirmed = await api.client.post(
        "/api/v1/auth/email/confirm-verification/",
        json={"email": address, "code": code},
        headers=api.auth(token),
    )
    assert confirmed.status_code == 200, confirmed.text

    me = await api.client.get("/api/v1/jwt/users/me/", headers=api.auth(token))
    body = me.json()
    assert body["email"] == address
    assert body["email_verified"] is True


async def test_email_change_resets_verification(
    api: _ApiCtx, email_channel: list[tuple[str, str]]
) -> None:
    """Смена адреса через профиль снимает подтверждение (иначе угон через почту)."""
    user = await api.make_user(phone_number=_random_phone())
    token = await api.token_for(user)
    address = f"user{uuid.uuid4().hex[:8]}@example.com"

    await api.client.post(
        "/api/v1/auth/email/request-verification/",
        json={"email": address},
        headers=api.auth(token),
    )
    await api.client.post(
        "/api/v1/auth/email/confirm-verification/",
        json={"email": address, "code": email_channel[-1][1]},
        headers=api.auth(token),
    )

    changed = await api.client.patch(
        "/api/v1/jwt/users/me/",
        json={"email": f"other{uuid.uuid4().hex[:8]}@example.com"},
        headers=api.auth(token),
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["email_verified"] is False


async def test_email_code_login(
    api: _ApiCtx, email_channel: list[tuple[str, str]]
) -> None:
    """Вход без пароля: код на подтверждённый адрес → токены."""
    user = await api.make_user(phone_number=_random_phone())
    token = await api.token_for(user)
    address = f"user{uuid.uuid4().hex[:8]}@example.com"
    await api.client.post(
        "/api/v1/auth/email/request-verification/",
        json={"email": address},
        headers=api.auth(token),
    )
    await api.client.post(
        "/api/v1/auth/email/confirm-verification/",
        json={"email": address, "code": email_channel[-1][1]},
        headers=api.auth(token),
    )

    requested = await api.client.post(
        "/api/v1/auth/email/login/request/", json={"email": address}
    )
    assert requested.status_code == 200, requested.text
    code = email_channel[-1][1]

    confirmed = await api.client.post(
        "/api/v1/auth/email/login/confirm/",
        json={"email": address, "code": code},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["access_token"] and confirmed.json()["refresh_token"]


async def test_email_login_does_not_leak_registration(
    api: _ApiCtx, email_channel: list[tuple[str, str]]
) -> None:
    """Незнакомый адрес: тот же ответ, но письма нет (нет перебора базы)."""
    response = await api.client.post(
        "/api/v1/auth/email/login/request/",
        json={"email": f"nobody{uuid.uuid4().hex[:8]}@example.com"},
    )

    assert response.status_code == 200, response.text
    assert "Если адрес привязан" in response.json()["detail"]
    assert email_channel == []


async def test_password_reset_by_email_code(
    api: _ApiCtx,
    monkeypatch: pytest.MonkeyPatch,
    email_channel: list[tuple[str, str]],
) -> None:
    """Сброс пароля: код из письма + новый пароль, прочие сессии отозваны."""
    phone, access = await _account_with_password(api, monkeypatch)
    address = f"user{uuid.uuid4().hex[:8]}@example.com"
    await api.client.post(
        "/api/v1/auth/email/request-verification/",
        json={"email": address},
        headers=api.auth(access),
    )
    await api.client.post(
        "/api/v1/auth/email/confirm-verification/",
        json={"email": address, "code": email_channel[-1][1]},
        headers=api.auth(access),
    )

    # «Другое устройство» — своя сессия, после сброса она должна умереть.
    other = await api.client.post(
        "/api/v1/auth/password/login/",
        json={"phone_number": phone, "password": _STRONG_PASSWORD},
    )
    other_refresh = other.json()["refresh_token"]

    requested = await api.client.post(
        "/api/v1/auth/password/reset/request/", json={"email": address}
    )
    assert requested.status_code == 200, requested.text
    code = email_channel[-1][1]

    # Слабый пароль политика не пропустит.
    weak = await api.client.post(
        "/api/v1/auth/password/reset/confirm/",
        json={"email": address, "code": code, "password": "1234567890"},
    )
    assert weak.status_code == 400, weak.text

    # Код одноразовый: после успешной проверки повторно им не воспользоваться.
    reset = await api.client.post(
        "/api/v1/auth/password/reset/confirm/",
        json={"email": address, "code": code, "password": "moloko-korova-77"},
    )
    assert reset.status_code == 200, reset.text
    assert reset.json()["access_token"] and reset.json()["refresh_token"]

    revoked = await api.client.post(
        "/api/v1/jwt/auth/refresh",
        headers={"Authorization": f"Bearer {other_refresh}"},
    )
    assert revoked.status_code == 401, revoked.text

    # Новый пароль работает, старый — нет.
    assert (
        await api.client.post(
            "/api/v1/auth/password/login/",
            json={"phone_number": phone, "password": "moloko-korova-77"},
        )
    ).status_code == 200
    assert (
        await api.client.post(
            "/api/v1/auth/password/login/",
            json={"phone_number": phone, "password": _STRONG_PASSWORD},
        )
    ).status_code == 401


async def test_email_endpoints_require_channel(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Без настроенного SMTP канал честно выключен (400), а не молча не работает."""
    monkeypatch.setattr("api_v1.auth.views.email_otp_available", lambda: False)

    response = await api.client.post(
        "/api/v1/auth/email/login/request/",
        json={"email": f"user{uuid.uuid4().hex[:8]}@example.com"},
    )

    assert response.status_code == 400, response.text
    assert "настроен" in response.json()["detail"]


# --- Уведомления о критичных действиях аккаунта ---------------------------
# Письма уходят только на ПОДТВЕРЖДЁННЫЙ e-mail, поэтому «свой» адрес в тестах
# задаём прямо в БД (подтверждение адреса проверяется отдельно, выше).


@pytest.fixture
def security_mail(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str, str]]:
    """Перехватывает письма-уведомления: список (адрес, тема, текст)."""
    sent: list[tuple[str, str, str]] = []

    def _fake(to: str, subject: str, body: str) -> None:
        sent.append((to, subject, body))

    monkeypatch.setattr(
        "api_v1.auth.security_notifications.enqueue_security_email", _fake
    )
    return sent


async def _verified_email_user(api: _ApiCtx, password: str = _STRONG_PASSWORD) -> tuple:
    """Создаёт пользователя с паролем и подтверждённым e-mail."""
    from core.security import get_password_hash

    address = f"owner{uuid.uuid4().hex[:8]}@example.com"
    user = await api.make_user(phone_number=_random_phone())
    async with api.factory() as session:
        db_user = await session.get(User, user.id)
        assert db_user is not None
        db_user.hashed_password = get_password_hash(password)
        db_user.password_set = True
        db_user.email = address
        db_user.email_verified = True
        await session.commit()
        await session.refresh(db_user)
    return db_user, address


async def test_password_change_notifies_owner(
    api: _ApiCtx, security_mail: list[tuple[str, str, str]]
) -> None:
    """Смена пароля: владелец получает письмо (иначе вылет устройств выглядит сбоем)."""
    user, address = await _verified_email_user(api)
    token = await api.token_for(user)

    response = await api.client.post(
        "/api/v1/auth/password/set/",
        json={"password": "novyj-parol-777", "current_password": _STRONG_PASSWORD},
        headers=api.auth(token),
    )

    assert response.status_code == 200, response.text
    assert len(security_mail) == 1
    sent_to, subject, body = security_mail[0]
    assert sent_to == address
    assert "пароль" in subject.lower()
    assert "устройства" in body.lower()


async def test_revoke_all_sessions_notifies_owner(
    api: _ApiCtx, security_mail: list[tuple[str, str, str]]
) -> None:
    """«Выйти на всех устройствах» — владелец должен узнать об этом."""
    user, address = await _verified_email_user(api)
    token = await api.token_for(user)

    response = await api.client.post(
        "/api/v1/auth/sessions/revoke-all/", headers=api.auth(token)
    )

    assert response.status_code == 200, response.text
    assert [mail[0] for mail in security_mail] == [address]
    assert "устройствах" in security_mail[0][1]


async def test_password_reset_notifies_owner(
    api: _ApiCtx,
    security_mail: list[tuple[str, str, str]],
    email_channel: list[tuple[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Сброс пароля по коду из письма тоже уведомляет владельца."""
    _, address = await _verified_email_user(api)
    monkeypatch.setattr("api_v1.auth.views.email_otp_available", lambda: True)

    await api.client.post(
        "/api/v1/auth/password/reset/request/", json={"email": address}
    )
    code = email_channel[-1][1]
    response = await api.client.post(
        "/api/v1/auth/password/reset/confirm/",
        json={"email": address, "code": code, "password": "novyj-parol-888"},
    )

    assert response.status_code == 200, response.text
    assert [mail[0] for mail in security_mail] == [address]
    assert "восстановлен" in security_mail[0][1].lower()


async def test_notifications_skipped_without_verified_email(
    api: _ApiCtx, security_mail: list[tuple[str, str, str]]
) -> None:
    """Нет подтверждённого адреса — письма нет (чужому ящику писать нельзя)."""
    from core.security import get_password_hash

    user = await api.make_user(phone_number=_random_phone())
    async with api.factory() as session:
        db_user = await session.get(User, user.id)
        assert db_user is not None
        db_user.hashed_password = get_password_hash(_STRONG_PASSWORD)
        db_user.password_set = True
        db_user.email = f"unverified{uuid.uuid4().hex[:8]}@example.com"
        db_user.email_verified = False
        await session.commit()
        await session.refresh(db_user)

    token = await api.token_for(db_user)
    response = await api.client.post(
        "/api/v1/auth/sessions/revoke-all/", headers=api.auth(token)
    )

    assert response.status_code == 200, response.text
    assert security_mail == []


async def test_email_change_notifies_old_address(
    api: _ApiCtx, security_mail: list[tuple[str, str, str]]
) -> None:
    """Смена адреса: письмо идёт на ПРЕЖНИЙ адрес — так владелец узнаёт о подмене."""
    user, old_address = await _verified_email_user(api)
    token = await api.token_for(user)
    new_address = f"new{uuid.uuid4().hex[:8]}@example.com"

    response = await api.client.patch(
        "/api/v1/jwt/users/me/",
        json={"email": new_address},
        headers=api.auth(token),
    )

    assert response.status_code == 200, response.text
    assert response.json()["email_verified"] is False
    assert [mail[0] for mail in security_mail] == [old_address]
    assert "адрес" in security_mail[0][1].lower()
    assert new_address in security_mail[0][2]


async def test_new_device_login_notifies_once(
    api: _ApiCtx, security_mail: list[tuple[str, str, str]]
) -> None:
    """Первый вход молчит, вход с нового устройства — письмо, повтор — без письма."""
    from core.security import get_password_hash

    phone = _random_phone()
    address = f"owner{uuid.uuid4().hex[:8]}@example.com"
    user = await api.make_user(phone_number=phone)
    async with api.factory() as session:
        db_user = await session.get(User, user.id)
        assert db_user is not None
        db_user.hashed_password = get_password_hash(_STRONG_PASSWORD)
        db_user.password_set = True
        db_user.email = address
        db_user.email_verified = True
        await session.commit()

    login = {"phone_number": phone, "password": _STRONG_PASSWORD}
    first = await api.client.post(
        "/api/v1/auth/password/login/",
        json=login,
        headers={"User-Agent": "PismoTest/1.0"},
    )
    assert first.status_code == 200, first.text
    assert security_mail == [], "первый вход (регистрация) письма не требует"

    second = await api.client.post(
        "/api/v1/auth/password/login/",
        json=login,
        headers={"User-Agent": "PismoTest/2.0 Novoe-ustrojstvo"},
    )
    assert second.status_code == 200, second.text
    assert [mail[0] for mail in security_mail] == [address]
    assert "нового устройства" in security_mail[0][1].lower()
    assert "Novoe-ustrojstvo" in security_mail[0][2]

    again = await api.client.post(
        "/api/v1/auth/password/login/",
        json=login,
        headers={"User-Agent": "PismoTest/2.0 Novoe-ustrojstvo"},
    )
    assert again.status_code == 200, again.text
    assert len(security_mail) == 1, "повторный вход с того же устройства — без письма"


async def test_notifications_have_daily_cap(
    api: _ApiCtx, security_mail: list[tuple[str, str, str]]
) -> None:
    """Суточный лимит писем: аккаунт не превращается в рассылку."""
    from api_v1.auth import security_notifications

    user, address = await _verified_email_user(api)
    async with api.factory() as session:
        db_user = await session.get(User, user.id)
        assert db_user is not None
        for _ in range(25):
            await security_notifications.notify_security_event(
                session, db_user, event="sessions_revoked"
            )

    assert len(security_mail) == 20, "не больше 20 писем в сутки на пользователя"
    assert all(mail[0] == address for mail in security_mail)


# --- 2FA на новом устройстве + список активных входов ---------------------


@pytest.fixture
def email_sender(monkeypatch: pytest.MonkeyPatch):
    """Считает SMTP настроенным и перехватывает письма с кодами (адрес, код)."""
    sent: list[tuple[str, str]] = []

    def _fake_enqueue(email: str, code: str, subject: str, body: str) -> None:
        sent.append((email, code))

    # SMTP «включён»: иначе сервер не может подтвердить вход кодом и обязан
    # пропустить новое устройство (запирать человека вне аккаунта нельзя).
    monkeypatch.setattr("core.mailer.is_configured", lambda: True)
    monkeypatch.setattr("api_v1.auth.views.email_otp_available", lambda: True)
    monkeypatch.setattr("api_v1.auth.views.enqueue_email_code", _fake_enqueue)
    return sent


def _login_request(phone: str, password: str, device: str) -> dict:
    """Тело+заголовки запроса входа с конкретного «устройства»."""
    return {
        "json": {"phone_number": phone, "password": password},
        "headers": {"User-Agent": device},
    }


async def test_new_device_login_requires_email_code(
    api: _ApiCtx, email_sender: list[tuple[str, str]]
) -> None:
    """Вход с нового устройства не выдаёт токены, пока не введён код из письма."""
    from core.security import get_password_hash

    phone = _random_phone()
    address = f"owner{uuid.uuid4().hex[:8]}@example.com"
    user = await api.make_user(phone_number=phone)
    async with api.factory() as session:
        db_user = await session.get(User, user.id)
        assert db_user is not None
        db_user.hashed_password = get_password_hash(_STRONG_PASSWORD)
        db_user.password_set = True
        db_user.email = address
        db_user.email_verified = True
        await session.commit()

    first = await api.client.post(
        "/api/v1/auth/password/login/",
        **_login_request(phone, _STRONG_PASSWORD, "PismoTest/1.0 Pervoe"),
    )
    assert first.status_code == 200, first.text
    assert email_sender == [], "первое устройство аккаунта код не требует"

    second = await api.client.post(
        "/api/v1/auth/password/login/",
        **_login_request(phone, _STRONG_PASSWORD, "PismoTest/2.0 Vtoroe"),
    )
    assert second.status_code == 428, second.text
    detail = second.json()["detail"]
    assert detail["challenge_token"], "сервер обязан вернуть challenge-токен"
    assert "***@" in detail["code_sent_to"], "адрес маскируется"
    assert email_sender and email_sender[-1][0] == address
    assert "access_token" not in second.json()

    code = email_sender[-1][1]
    verified = await api.client.post(
        "/api/v1/auth/login/verify-device/",
        json={"challenge_token": detail["challenge_token"], "code": code},
        headers={"User-Agent": "PismoTest/2.0 Vtoroe"},
    )
    assert verified.status_code == 200, verified.text
    assert verified.json()["access_token"] and verified.json()["refresh_token"]

    # Устройство запомнено — следующий вход с него проходит без кода.
    third = await api.client.post(
        "/api/v1/auth/password/login/",
        **_login_request(phone, _STRONG_PASSWORD, "PismoTest/2.0 Vtoroe"),
    )
    assert third.status_code == 200, third.text
    assert len(email_sender) == 1


async def test_device_verify_rejects_wrong_code_and_foreign_device(
    api: _ApiCtx, email_sender: list[tuple[str, str]]
) -> None:
    """Код проверяется, а challenge нельзя подтвердить с другого устройства."""
    from core.security import get_password_hash

    phone = _random_phone()
    user = await api.make_user(phone_number=phone)
    async with api.factory() as session:
        db_user = await session.get(User, user.id)
        assert db_user is not None
        db_user.hashed_password = get_password_hash(_STRONG_PASSWORD)
        db_user.password_set = True
        db_user.email = f"owner{uuid.uuid4().hex[:8]}@example.com"
        db_user.email_verified = True
        await session.commit()

    await api.client.post(
        "/api/v1/auth/password/login/",
        **_login_request(phone, _STRONG_PASSWORD, "PismoTest/1.0 Pervoe"),
    )
    challenge = (
        await api.client.post(
            "/api/v1/auth/password/login/",
            **_login_request(phone, _STRONG_PASSWORD, "PismoTest/2.0 Vtoroe"),
        )
    ).json()["detail"]["challenge_token"]

    wrong = await api.client.post(
        "/api/v1/auth/login/verify-device/",
        json={"challenge_token": challenge, "code": "000000"},
        headers={"User-Agent": "PismoTest/2.0 Vtoroe"},
    )
    assert wrong.status_code == 401, wrong.text

    foreign = await api.client.post(
        "/api/v1/auth/login/verify-device/",
        json={"challenge_token": challenge, "code": email_sender[-1][1]},
        headers={"User-Agent": "PismoTest/3.0 Chuzhoe"},
    )
    assert foreign.status_code == 401, foreign.text
    assert "Войдите заново" in foreign.json()["detail"]

    broken = await api.client.post(
        "/api/v1/auth/login/verify-device/",
        json={"challenge_token": "не-jwt", "code": "123456"},
        headers={"User-Agent": "PismoTest/2.0 Vtoroe"},
    )
    assert broken.status_code == 401, broken.text


async def test_new_device_without_verified_email_is_allowed(
    api: _ApiCtx, email_sender: list[tuple[str, str]]
) -> None:
    """Если подтвердить вход нечем, человека не запирают: вход проходит."""
    from core.security import get_password_hash

    phone = _random_phone()
    user = await api.make_user(phone_number=phone)
    async with api.factory() as session:
        db_user = await session.get(User, user.id)
        assert db_user is not None
        db_user.hashed_password = get_password_hash(_STRONG_PASSWORD)
        db_user.password_set = True
        await session.commit()

    await api.client.post(
        "/api/v1/auth/password/login/",
        **_login_request(phone, _STRONG_PASSWORD, "PismoTest/1.0 Pervoe"),
    )
    second = await api.client.post(
        "/api/v1/auth/password/login/",
        **_login_request(phone, _STRONG_PASSWORD, "PismoTest/2.0 Vtoroe"),
    )

    assert second.status_code == 200, second.text
    assert email_sender == [], "и письма с кодом быть не может — адреса нет"


async def test_sessions_list_and_single_revoke(api: _ApiCtx) -> None:
    """Профиль видит активные входы и может отозвать любой по отдельности."""
    from core.security import get_password_hash

    phone = _random_phone()
    user = await api.make_user(phone_number=phone)
    async with api.factory() as session:
        db_user = await session.get(User, user.id)
        assert db_user is not None
        db_user.hashed_password = get_password_hash(_STRONG_PASSWORD)
        db_user.password_set = True
        await session.commit()

    device_a = "PismoTest/1.0 Pervoe"
    device_b = "PismoTest/2.0 Vtoroe"
    login_a = await api.client.post(
        "/api/v1/auth/password/login/",
        **_login_request(phone, _STRONG_PASSWORD, device_a),
    )
    assert login_a.status_code == 200, login_a.text
    login_b = await api.client.post(
        "/api/v1/auth/password/login/",
        **_login_request(phone, _STRONG_PASSWORD, device_b),
    )
    assert login_b.status_code == 200, login_b.text

    token_b = login_b.json()["access_token"]
    listing = await api.client.get(
        "/api/v1/auth/sessions/",
        headers={**api.auth(token_b), "User-Agent": device_b},
    )
    assert listing.status_code == 200, listing.text
    sessions = listing.json()["sessions"]
    assert len(sessions) == 2, sessions
    assert sum(1 for row in sessions if row["current"]) == 1
    assert {row["device"] for row in sessions} == {device_a, device_b}

    other = next(row for row in sessions if not row["current"])
    revoked = await api.client.delete(
        f"/api/v1/auth/sessions/{other['id']}/",
        headers={**api.auth(token_b), "User-Agent": device_b},
    )
    assert revoked.status_code == 200, revoked.text

    after = await api.client.get(
        "/api/v1/auth/sessions/",
        headers={**api.auth(token_b), "User-Agent": device_b},
    )
    assert [row["id"] for row in after.json()["sessions"]] == [
        row["id"] for row in sessions if row["current"]
    ]

    # Повторный отзыв той же сессии — 404 (проверяем до попытки «переиспользовать»
    # refresh: после неё гасятся ВСЕ сессии, и на этом токене уже будет 401).
    missing = await api.client.delete(
        f"/api/v1/auth/sessions/{other['id']}/",
        headers={**api.auth(token_b), "User-Agent": device_b},
    )
    assert missing.status_code == 404, missing.text

    # Отозванная сессия больше не может продлить вход, а попытка «переиспользовать»
    # её refresh = признак кражи: гаснут ВСЕ сессии, включая текущий access-токен.
    refresh_a = await api.client.post(
        "/api/v1/jwt/auth/refresh",
        headers={"Authorization": f"Bearer {login_a.json()['refresh_token']}"},
    )
    assert refresh_a.status_code == 401, refresh_a.text

    dead = await api.client.get(
        "/api/v1/auth/sessions/",
        headers={**api.auth(token_b), "User-Agent": device_b},
    )
    assert dead.status_code == 401, dead.text
    assert dead.json()["detail"]["code"] == "session_revoked"


async def test_sessions_list_hides_foreign_sessions(api: _ApiCtx) -> None:
    """В списке только свои входы: чужая сессия не отзывается (404)."""
    from core.security import get_password_hash

    async def _with_password() -> tuple[User, str]:
        phone = _random_phone()
        user = await api.make_user(phone_number=phone)
        async with api.factory() as session:
            db_user = await session.get(User, user.id)
            assert db_user is not None
            db_user.hashed_password = get_password_hash(_STRONG_PASSWORD)
            db_user.password_set = True
            await session.commit()
            await session.refresh(db_user)
        return db_user, phone

    _, phone_one = await _with_password()
    _, phone_two = await _with_password()

    one = await api.client.post(
        "/api/v1/auth/password/login/",
        **_login_request(phone_one, _STRONG_PASSWORD, "PismoTest/1.0 Pervoe"),
    )
    two = await api.client.post(
        "/api/v1/auth/password/login/",
        **_login_request(phone_two, _STRONG_PASSWORD, "PismoTest/1.0 Vtoroe"),
    )

    foreign_id = (
        await api.client.get(
            "/api/v1/auth/sessions/",
            headers=api.auth(two.json()["access_token"]),
        )
    ).json()["sessions"][0]["id"]

    attack = await api.client.delete(
        f"/api/v1/auth/sessions/{foreign_id}/",
        headers=api.auth(one.json()["access_token"]),
    )
    assert attack.status_code == 404, attack.text


# --- Квоты на медиа -------------------------------------------------------


async def test_media_quota_blocks_upload_and_frees_on_delete(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Квота ограничивает накопление, а удаление сообщения освобождает место."""
    from core import config

    u1 = await api.make_user()
    u2 = await api.make_user()
    chat = await api.private_chat(await api.token_for(u1), u2.id)
    token = await api.token_for(u1)

    # Небольшая квота, чтобы не заливать мегабайты в тесте: 10 «единиц».
    monkeypatch.setattr(config.settings, "media_quota_bytes", 10)

    empty = await api.client.get("/api/v1/users/me/storage/", headers=api.auth(token))
    assert empty.status_code == 200, empty.text
    assert empty.json() == {
        "used_bytes": 0,
        "quota_bytes": 10,
        "files": 0,
        "percent": 0,
    }

    first = await api.client.post(
        "/api/v1/messages/attachment/",
        params={"chat_id": chat["id"], "filename": "doc1.txt"},
        content=b"0123456",
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )
    assert first.status_code == 200, first.text

    usage = await api.client.get("/api/v1/users/me/storage/", headers=api.auth(token))
    assert usage.json()["used_bytes"] == 7
    assert usage.json()["files"] == 1
    assert usage.json()["percent"] == 70

    # Второй файл в квоту не влезает: 413 и понятное объяснение.
    second = await api.client.post(
        "/api/v1/messages/attachment/",
        params={"chat_id": chat["id"], "filename": "doc2.txt"},
        content=b"0123456",
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )
    assert second.status_code == 413, second.text
    assert "Хранилище заполнено" in second.json()["detail"]

    # Место освобождается сразу после удаления сообщения.
    removed = await api.client.delete(
        f"/api/v1/messages/{first.json()['id']}/", headers=api.auth(token)
    )
    assert removed.status_code == 204, removed.text
    after = await api.client.get("/api/v1/users/me/storage/", headers=api.auth(token))
    assert after.json()["used_bytes"] == 0
    assert after.json()["files"] == 0


async def test_media_quota_ignores_forwarded_copies(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Пересылка переиспользует файл — второй раз в квоту он не считается."""
    from core import config

    u1 = await api.make_user()
    u2 = await api.make_user()
    token = await api.token_for(u1)
    source_chat = await api.private_chat(token, u2.id)
    other_chat = await api.private_chat(token, u2.id)

    monkeypatch.setattr(config.settings, "media_quota_bytes", 100)
    uploaded = await api.client.post(
        "/api/v1/messages/attachment/",
        params={"chat_id": source_chat["id"], "filename": "doc.txt"},
        content=b"0123456789",
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )
    assert uploaded.status_code == 200, uploaded.text

    forwarded = await api.client.post(
        "/api/v1/messages/forward/",
        json={"message_id": uploaded.json()["id"], "chat_id": other_chat["id"]},
        headers=api.auth(token),
    )
    assert forwarded.status_code == 200, forwarded.text

    usage = await api.client.get("/api/v1/users/me/storage/", headers=api.auth(token))
    assert usage.json()["used_bytes"] == 10, "пересланная копия не должна дублироваться"
    assert usage.json()["files"] == 1


async def test_media_quota_can_be_disabled(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Квота 0 (или меньше) выключает ограничение — на случай аварии."""
    from core import config

    u1 = await api.make_user()
    u2 = await api.make_user()
    token = await api.token_for(u1)
    chat = await api.private_chat(token, u2.id)

    monkeypatch.setattr(config.settings, "media_quota_bytes", 0)
    uploaded = await api.client.post(
        "/api/v1/messages/attachment/",
        params={"chat_id": chat["id"], "filename": "big.txt"},
        content=b"0" * 1024,
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )

    assert uploaded.status_code == 200, uploaded.text
    usage = await api.client.get("/api/v1/users/me/storage/", headers=api.auth(token))
    assert usage.json()["quota_bytes"] == 0
    assert usage.json()["percent"] == 0


# --- Модерация: авто-скрытие по жалобам и журнал --------------------------


@pytest.fixture
def reported_user_email(api: _ApiCtx, monkeypatch: pytest.MonkeyPatch):
    """Перехватывает письма модерации (без реальной отправки)."""
    sent: list[tuple[str, str, str]] = []

    def _fake(to: str, subject: str, body: str) -> None:
        sent.append((to, subject, body))

    monkeypatch.setattr(
        "api_v1.auth.security_notifications.enqueue_security_email", _fake
    )
    return sent


async def _author_message_with_reports(
    api: _ApiCtx, count: int
) -> tuple[dict, list[tuple[User, str]], User, str]:
    """Готовит группу, сообщение автора и ``count`` жалоб от разных участников.

    Именно группа, а не личный чат: жалобу можно подать только на сообщение из
    своего чата, а «3 разные жалобы» в личном чате физически невозможны.
    """
    author = await api.make_user()
    tauthor = await api.token_for(author)

    reporters: list[tuple[User, str]] = []
    for _ in range(count):
        reporter = await api.make_user()
        reporters.append((reporter, await api.token_for(reporter)))

    group = await _create_group(
        api, tauthor, "Группа жалоб", [reporter.id for reporter, _ in reporters]
    )
    message = await api.send(tauthor, group["id"], "маркер-жалобы")

    # Письма модерации уходят на e-mail аккаунта, поэтому адреса нужны и автору
    # (ему пишем о скрытии), и заявителям (им — решение по жалобе).
    async with api.factory() as session:
        for user in [author, *[reporter for reporter, _ in reporters]]:
            row = await session.get(User, user.id)
            assert row is not None
            row.email = f"mod{uuid.uuid4().hex[:8]}@example.com"
        await session.commit()

    for reporter, token in reporters:
        response = await api.client.post(
            "/api/v1/moderation/reports/",
            json={
                "user_id": author.id,
                "reason": "spam",
                "message_id": message["id"],
                "comment": "спам",
            },
            headers=api.auth(token),
        )
        assert response.status_code == 201, response.text
    return message, reporters, author, tauthor


async def _messages_in_chat(api: _ApiCtx, token: str, chat_id: int) -> list[dict]:
    response = await api.client.get(
        f"/api/v1/messages/{chat_id}/", headers=api.auth(token)
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_two_reports_do_not_hide_message(
    api: _ApiCtx, reported_user_email: list[tuple[str, str, str]]
) -> None:
    """Порог авто-скрытия — 3 жалобы от разных людей, две ничего не скрывают."""
    message, _reporters, _author, tauthor = await _author_message_with_reports(api, 2)

    rows = await _messages_in_chat(api, tauthor, message["chat_id"])
    assert rows[-1]["hidden"] is False


async def test_third_report_hides_message_for_everyone_but_author(
    api: _ApiCtx, reported_user_email: list[tuple[str, str, str]]
) -> None:
    """3 жалобы → сообщение скрыто: другие его не видят, автор видит с пометкой."""
    message, reporters, _author, tauthor = await _author_message_with_reports(api, 3)

    # Автор видит сообщение и пометку, что оно скрыто до проверки.
    rows = await _messages_in_chat(api, tauthor, message["chat_id"])
    hidden_row = next(row for row in rows if row["id"] == message["id"])
    assert hidden_row["hidden"] is True
    assert "жалоб" in (hidden_row["hidden_reason"] or "")

    # Другой участник группы не видит скрытое вообще.
    _reporter, treporter = reporters[0]
    reporter_rows = await _messages_in_chat(api, treporter, message["chat_id"])
    assert message["id"] not in [row["id"] for row in reporter_rows]

    # Поиск тоже не находит скрытое.
    found = await api.client.get(
        "/api/v1/messages/search/",
        params={"q": "маркер-жалобы"},
        headers=api.auth(treporter),
    )
    assert found.status_code == 200, found.text
    assert found.json() == []

    # Пересылать скрытое нельзя.
    forwarded = await api.client.post(
        "/api/v1/messages/forward/",
        json={"message_id": message["id"], "chat_id": message["chat_id"]},
        headers=api.auth(tauthor),
    )
    assert forwarded.status_code == 400, forwarded.text

    # Превью чата в списке не раскрывает содержимое скрытого.
    chats = await api.client.get("/api/v1/chats/", headers=api.auth(treporter))
    group_preview = next(
        item["last_message"]
        for item in chats.json()
        if item["id"] == message["chat_id"]
    )
    assert group_preview["text"] == ""
    assert group_preview["hidden"] is True

    # Автору ушло письмо о скрытии.
    assert any(
        "скрыто" in subject.lower() for _to, subject, _body in reported_user_email
    )


async def test_same_reporter_twice_does_not_hide(
    api: _ApiCtx, reported_user_email: list[tuple[str, str, str]]
) -> None:
    """Считаем РАЗНЫХ заявителей: один человек не скроет контент четырьмя жалобами."""
    message, reporters, _author, tauthor = await _author_message_with_reports(api, 1)
    _reporter, treporter = reporters[0]

    for _ in range(3):
        created = await api.client.post(
            "/api/v1/moderation/reports/",
            json={
                "user_id": message["user_id"],
                "reason": "spam",
                "message_id": message["id"],
            },
            headers=api.auth(treporter),
        )
        assert created.status_code == 201, created.text

    rows = await _messages_in_chat(api, tauthor, message["chat_id"])
    assert next(row for row in rows if row["id"] == message["id"])["hidden"] is False


async def test_moderator_decision_hides_and_restores(
    api: _ApiCtx, reported_user_email: list[tuple[str, str, str]]
) -> None:
    """Модератор подтверждает нарушение (скрывает) или отклоняет жалобу (возвращает)."""
    message, _reporters, author, tauthor = await _author_message_with_reports(api, 3)
    _admin, tadmin = await _make_admin(api)

    reports = await api.client.get(
        "/api/v1/moderation/reports/?status=new", headers=api.auth(tadmin)
    )
    report_id = reports.json()["items"][0]["id"]

    # Отклоняем — авто-скрытие снимается, сообщение снова можно пересылать.
    rejected = await api.client.patch(
        f"/api/v1/moderation/reports/{report_id}/",
        json={"status": "rejected", "note": "нарушения нет"},
        headers=api.auth(tadmin),
    )
    assert rejected.status_code == 200, rejected.text

    forwarded = await api.client.post(
        "/api/v1/messages/forward/",
        json={"message_id": message["id"], "chat_id": message["chat_id"]},
        headers=api.auth(tauthor),
    )
    assert forwarded.status_code == 200, forwarded.text
    assert any(
        "рассмотрена" in subject.lower() for _to, subject, _body in reported_user_email
    )

    # Подтверждаем нарушение — сообщение скрыто до восстановления вручную.
    resolved = await api.client.patch(
        f"/api/v1/moderation/reports/{report_id}/",
        json={"status": "resolved", "note": "спам подтверждён"},
        headers=api.auth(tadmin),
    )
    assert resolved.status_code == 200, resolved.text
    rows = await _messages_in_chat(api, tauthor, message["chat_id"])
    row = next(item for item in rows if item["id"] == message["id"])
    assert row["hidden"] is True
    assert row["hidden_reason"] == "спам подтверждён"

    # Админ может вернуть контент одним действием — и это попадает в журнал.
    restored = await api.client.post(
        f"/api/v1/moderation/users/{author.id}/unhide/", headers=api.auth(tadmin)
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["restored"] == 1


async def test_moderation_journal_records_actions(
    api: _ApiCtx, reported_user_email: list[tuple[str, str, str]]
) -> None:
    """Журнал показывает и действия автомата, и решения модератора."""
    message, _reporters, author, _tauthor = await _author_message_with_reports(api, 3)
    _admin, tadmin = await _make_admin(api)

    journal = await api.client.get(
        "/api/v1/moderation/journal/", headers=api.auth(tadmin)
    )
    assert journal.status_code == 200, journal.text
    payload = journal.json()
    actions = [item["action"] for item in payload["items"]]
    assert "report_created" in actions
    assert "message_auto_hidden" in actions
    assert payload["hidden_messages"] == 1
    auto = next(
        item for item in payload["items"] if item["action"] == "message_auto_hidden"
    )
    assert auto["moderator_id"] is None, "авто-скрытие пишется без модератора"
    assert auto["message_id"] == message["id"]
    assert auto["target_user_id"] == author.id

    # Журнал — только для администраторов.
    outsider = await api.make_user()
    denied = await api.client.get(
        "/api/v1/moderation/journal/", headers=api.auth(await api.token_for(outsider))
    )
    assert denied.status_code == 403, denied.text


# --- Журнал безопасности аккаунта ----------------------------------------


async def test_security_log_records_login_and_password_change(
    api: _ApiCtx, email_sender: list[tuple[str, str]]
) -> None:
    """Владелец видит историю: вход, смену пароля, запрос кода."""
    from core.security import get_password_hash

    phone = _random_phone()
    address = f"owner{uuid.uuid4().hex[:8]}@example.com"
    user = await api.make_user(phone_number=phone)
    async with api.factory() as session:
        db_user = await session.get(User, user.id)
        assert db_user is not None
        db_user.hashed_password = get_password_hash(_STRONG_PASSWORD)
        db_user.password_set = True
        db_user.email = address
        db_user.email_verified = True
        await session.commit()

    failed = await api.client.post(
        "/api/v1/auth/password/login/",
        **_login_request(phone, "sovsem-drugoy-parol", "PismoTest/1.0"),
    )
    assert failed.status_code == 401, failed.text

    logged_in = await api.client.post(
        "/api/v1/auth/password/login/",
        **_login_request(phone, _STRONG_PASSWORD, "PismoTest/1.0"),
    )
    assert logged_in.status_code == 200, logged_in.text
    token = logged_in.json()["access_token"]

    changed = await api.client.post(
        "/api/v1/auth/password/set/",
        json={"password": "novyj-parol-999", "current_password": _STRONG_PASSWORD},
        headers=api.auth(token),
    )
    assert changed.status_code == 200, changed.text

    # Прежний access-токен отозван СРАЗУ (а не через 30 минут): смена пароля
    # поднимает эпоху доступа.
    stale = await api.client.get("/api/v1/auth/security-log/", headers=api.auth(token))
    assert stale.status_code == 401, stale.text
    assert stale.json()["detail"]["code"] == "session_revoked"
    token = changed.json()["access_token"]

    log = await api.client.get("/api/v1/auth/security-log/", headers=api.auth(token))
    assert log.status_code == 200, log.text
    events = log.json()["items"]
    codes = [entry["event"] for entry in events]
    assert "login_success" in codes
    assert "login_failed" in codes
    assert "password_changed" in codes
    # Заголовки человекочитаемые, IP и устройство заполнены.
    success = next(entry for entry in events if entry["event"] == "login_success")
    assert success["title"] == "Вход в аккаунт"
    assert success["device"] == "PismoTest/1.0"


async def test_security_log_is_private_to_owner(
    api: _ApiCtx, email_sender: list[tuple[str, str]]
) -> None:
    """Чужой журнал недоступен: список отдаётся по аккаунту из токена."""
    from core.security import get_password_hash

    async def _login(phone: str) -> str:
        user = await api.make_user(phone_number=phone)
        async with api.factory() as session:
            db_user = await session.get(User, user.id)
            assert db_user is not None
            db_user.hashed_password = get_password_hash(_STRONG_PASSWORD)
            db_user.password_set = True
            await session.commit()
        response = await api.client.post(
            "/api/v1/auth/password/login/",
            **_login_request(phone, _STRONG_PASSWORD, "PismoTest/1.0"),
        )
        assert response.status_code == 200, response.text
        return str(response.json()["access_token"])

    token_one = await _login(_random_phone())
    token_two = await _login(_random_phone())

    first = await api.client.get(
        "/api/v1/auth/security-log/", headers=api.auth(token_one)
    )
    second = await api.client.get(
        "/api/v1/auth/security-log/", headers=api.auth(token_two)
    )

    assert first.status_code == 200 and second.status_code == 200
    assert len(first.json()["items"]) == 1, "в журнале ровно один свой вход"
    assert len(second.json()["items"]) == 1
    assert first.json()["items"][0]["id"] != second.json()["items"][0]["id"]

    anonymous = await api.client.get("/api/v1/auth/security-log/")
    assert anonymous.status_code == 401, anonymous.text


async def test_security_log_covers_sessions_and_email_change(api: _ApiCtx) -> None:
    """Отзыв сессий и смена адреса тоже попадают в историю."""
    from core.security import get_password_hash

    phone = _random_phone()
    user = await api.make_user(phone_number=phone)
    async with api.factory() as session:
        db_user = await session.get(User, user.id)
        assert db_user is not None
        db_user.hashed_password = get_password_hash(_STRONG_PASSWORD)
        db_user.password_set = True
        db_user.email = f"old{uuid.uuid4().hex[:8]}@example.com"
        db_user.email_verified = True
        await session.commit()

    login = await api.client.post(
        "/api/v1/auth/password/login/", **_login_request(phone, _STRONG_PASSWORD, "D1")
    )
    body = login.json()
    token = body["access_token"]

    # Передаём свой refresh-токен: текущее устройство остаётся в системе, поэтому
    # из ответа берём новую пару — старый access отозван сразу.
    revoked = await api.client.post(
        "/api/v1/auth/sessions/revoke-all/",
        json={"refresh_token": body["refresh_token"]},
        headers=api.auth(token),
    )
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["refresh_token"]
    assert revoked.json()["access_token"]
    token = revoked.json()["access_token"]
    await api.client.patch(
        "/api/v1/jwt/users/me/",
        json={"email": f"new{uuid.uuid4().hex[:8]}@example.com"},
        headers=api.auth(token),
    )

    log = await api.client.get("/api/v1/auth/security-log/", headers=api.auth(token))
    codes = [entry["event"] for entry in log.json()["items"]]
    assert "sessions_revoked" in codes
    assert "email_changed" in codes


# --- Ротация JWT-секрета --------------------------------------------------


def _sign_with(secret: str, user_id: int) -> str:
    """Токен fastapi-users, подписанный заданным секретом (как будто старым)."""
    import jwt

    from core.config import settings

    return jwt.encode(
        {"sub": str(user_id), "aud": "fastapi-users:auth"},
        secret,
        algorithm=settings.auth_jwt.algorithm,
    )


async def test_previous_secret_still_accepted_after_rotation(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """После смены ключа старые токены работают, пока задан предыдущий секрет.

    Иначе ротация ключа мгновенно разлогинила бы всех: refresh-токены живут 30 дней
    и подписаны старым секретом.
    """
    from core.config import settings

    old_secret = "старый-секрет-ротации-0001"
    new_secret = settings.auth_jwt.secret_key

    user = await api.make_user()
    # На сервере «сменили» ключ: текущий — новый, предыдущий — старый.
    monkeypatch.setattr(settings.auth_jwt, "secret_key", new_secret)
    monkeypatch.setattr(settings.auth_jwt, "secret_key_previous", old_secret)

    old_token = _sign_with(old_secret, int(user.id))
    new_token = _sign_with(new_secret, int(user.id))

    for label, token in (("старый", old_token), ("новый", new_token)):
        # fastapi-users (/jwt/users/me/) — своя стратегия проверки.
        jwt_me = await api.client.get("/api/v1/jwt/users/me/", headers=api.auth(token))
        assert jwt_me.status_code == 200, f"{label} токен: {jwt_me.text}"
        # Наш get_current_user (кастомные эндпоинты).
        custom = await api.client.get("/api/v1/auth/sessions/", headers=api.auth(token))
        assert custom.status_code == 200, f"{label} токен: {custom.text}"

    # Токен, подписанный посторонним ключом, по-прежнему не принимается.
    stranger = _sign_with("совсем-чужой-ключ-9999", int(user.id))
    denied = await api.client.get("/api/v1/auth/sessions/", headers=api.auth(stranger))
    assert denied.status_code == 401, denied.text


async def test_new_tokens_signed_with_current_secret_only(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Новые токены подписываются текущим (новым) секретом, а не предыдущим."""
    import jwt

    from core.config import settings

    old_secret = "старый-секрет-ротации-0002"
    monkeypatch.setattr(settings.auth_jwt, "secret_key_previous", old_secret)

    phone = _random_phone()
    user = await api.make_user(phone_number=phone)
    token = await api.token_for(user)

    decoded_new = jwt.decode(
        token,
        settings.auth_jwt.secret_key,
        algorithms=[settings.auth_jwt.algorithm],
        options={"verify_aud": False},
    )
    assert decoded_new["sub"] == str(user.id)

    with pytest.raises(jwt.InvalidTokenError):
        jwt.decode(
            token,
            old_secret,
            algorithms=[settings.auth_jwt.algorithm],
            options={"verify_aud": False},
        )


async def test_accepted_secrets_deduplicates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Если предыдущий секрет совпадает с текущим, он не дублируется."""
    from core.config import settings

    monkeypatch.setattr(
        settings.auth_jwt, "secret_key_previous", settings.auth_jwt.secret_key
    )
    assert settings.auth_jwt.accepted_secrets() == [settings.auth_jwt.secret_key]

    monkeypatch.setattr(settings.auth_jwt, "secret_key_previous", "  ")
    assert settings.auth_jwt.accepted_secrets() == [settings.auth_jwt.secret_key]


# --- E2EE: ключ группы и шифрованные вложения ------------------------------


async def _enable_group_e2ee(api: _ApiCtx, token: str, chat_id: int) -> None:
    """Включает сквозное шифрование в группе (создателем/админом)."""
    response = await api.client.put(
        f"/api/v1/chats/{chat_id}/e2ee/",
        json={"enabled": True},
        headers=api.auth(token),
    )
    assert response.status_code == 200, response.text
    assert response.json()["e2ee_enabled"] is True


async def test_group_e2ee_toggle_requires_admin(api: _ApiCtx) -> None:
    """Шифрование группы включает только создатель/админ, участник — 403."""
    u1 = await api.make_user()
    u2 = await api.make_user()
    t1 = await api.token_for(u1)
    t2 = await api.token_for(u2)
    chat = await _create_group(api, t1, "Секретная группа", [u2.id])

    member_try = await api.client.put(
        f"/api/v1/chats/{chat['id']}/e2ee/",
        json={"enabled": True},
        headers=api.auth(t2),
    )
    assert member_try.status_code == 403

    await _enable_group_e2ee(api, t1, chat["id"])

    # Флаг виден в списке чатов (фронт рисует замок).
    chat_card = next(c for c in await _my_chats(api, t2) if c["id"] == chat["id"])
    assert chat_card["e2ee_enabled"] is True


async def test_group_e2ee_keys_distribution_and_guards(api: _ApiCtx) -> None:
    """Обёртки ключа группы: доступ только участникам и только им в раздачу."""
    u1 = await api.make_user()
    u2 = await api.make_user()
    u3 = await api.make_user()
    t1 = await api.token_for(u1)
    t2 = await api.token_for(u2)
    t3 = await api.token_for(u3)
    chat = await _create_group(api, t1, "Ключи", [u2.id])
    keys_url = f"/api/v1/keys/group/{chat['id']}/"

    # Пока шифрование выключено, ключа нет: эндпоинт отвечает 200 и has_key=false
    # (клиент не должен отличать «не включено» от «ещё не раздали»).
    r = await api.client.get(keys_url, headers=api.auth(t1))
    assert r.status_code == 200
    assert r.json()["has_key"] is False

    # А раздавать обёртки в незашифрованной группе нельзя — 400.
    r = await api.client.put(
        keys_url,
        json={"keys": [{"user_id": u1.id, "wrapped_key": "e2ee1:x:y"}]},
        headers=api.auth(t1),
    )
    assert r.status_code == 400

    await _enable_group_e2ee(api, t1, chat["id"])

    # Ключа ещё нет ни у кого — участник видит has_key=false, а не ошибку.
    r = await api.client.get(keys_url, headers=api.auth(t2))
    assert r.status_code == 200
    assert r.json()["has_key"] is False

    # Создатель раздаёт свою обёртку и обёртку участника.
    r = await api.client.put(
        keys_url,
        json={
            "keys": [
                {"user_id": u1.id, "wrapped_key": "e2ee1:aaaa:bbbb"},
                {"user_id": u2.id, "wrapped_key": "e2ee1:cccc:dddd"},
            ],
            "replace": True,
        },
        headers=api.auth(t1),
    )
    assert r.status_code == 200, r.text
    assert r.json()["count"] == 2

    # Каждый читает СВОЮ обёртку и узнаёт, кто её раздал (нужно для расшифровки).
    mine = (await api.client.get(keys_url, headers=api.auth(t2))).json()
    assert mine["has_key"] is True
    assert mine["wrapped_key"] == "e2ee1:cccc:dddd"
    assert mine["wrapped_by"] == u1.id

    # Посторонний не видит ключ и не может раздавать.
    r = await api.client.get(keys_url, headers=api.auth(t3))
    assert r.status_code == 404
    r = await api.client.put(
        keys_url,
        json={"keys": [{"user_id": u1.id, "wrapped_key": "e2ee1:x:y"}]},
        headers=api.auth(t3),
    )
    assert r.status_code == 404

    # Раздавать можно только действующим участникам чата.
    r = await api.client.put(
        keys_url,
        json={"keys": [{"user_id": u3.id, "wrapped_key": "e2ee1:x:y"}]},
        headers=api.auth(t1),
    )
    assert r.status_code == 400


async def test_group_e2ee_key_rotation_replaces_wrappers(api: _ApiCtx) -> None:
    """Ротация ключа: replace=true убирает прежние обёртки участников."""
    u1 = await api.make_user()
    u2 = await api.make_user()
    u3 = await api.make_user()
    t1 = await api.token_for(u1)
    t2 = await api.token_for(u2)
    chat = await _create_group(api, t1, "Ротация", [u2.id, u3.id])
    keys_url = f"/api/v1/keys/group/{chat['id']}/"
    await _enable_group_e2ee(api, t1, chat["id"])

    r = await api.client.put(
        keys_url,
        json={
            "keys": [
                {"user_id": u1.id, "wrapped_key": "e2ee1:v1:v1"},
                {"user_id": u2.id, "wrapped_key": "e2ee1:v1:v1"},
                {"user_id": u3.id, "wrapped_key": "e2ee1:v1:v1"},
            ],
            "replace": True,
        },
        headers=api.auth(t1),
    )
    assert r.status_code == 200, r.text

    # Исключаем u3 и выпускаем новый ключ для оставшихся.
    kicked = await api.client.delete(
        f"/api/v1/chats/{chat['id']}/members/{u3.id}/", headers=api.auth(t1)
    )
    assert kicked.status_code in (200, 204), kicked.text

    r = await api.client.put(
        keys_url,
        json={
            "keys": [
                {"user_id": u1.id, "wrapped_key": "e2ee1:v2:v2"},
                {"user_id": u2.id, "wrapped_key": "e2ee1:v2:v2"},
            ],
            "replace": True,
        },
        headers=api.auth(t1),
    )
    assert r.status_code == 200, r.text
    assert r.json()["count"] == 2

    # У оставшегося участника — обёртка НОВОГО ключа, а не прежняя.
    mine = (await api.client.get(keys_url, headers=api.auth(t2))).json()
    assert mine["wrapped_key"] == "e2ee1:v2:v2"

    # Раздача себе без replace не затирает обёртки остальных.
    r = await api.client.put(
        keys_url,
        json={"keys": [{"user_id": u1.id, "wrapped_key": "e2ee1:v3:v3"}]},
        headers=api.auth(t1),
    )
    assert r.status_code == 200, r.text
    still = (await api.client.get(keys_url, headers=api.auth(t2))).json()
    assert still["wrapped_key"] == "e2ee1:v2:v2"


async def test_encrypted_attachment_only_in_e2ee_chat(api: _ApiCtx) -> None:
    """Шифрованное вложение принимается только в зашифрованном чате."""
    u1 = await api.make_user()
    u2 = await api.make_user()
    token = await api.token_for(u1)

    created = await api.client.post(
        "/api/v1/chats/private/",
        json={"user_id": u2.id},
        headers=api.auth(token),
    )
    assert created.status_code == 200, created.text
    chat_id = created.json()["id"]

    # Обычный (незашифрованный) чат шифрованный блоб не принимает: иначе на
    # сервере оказался бы ключ файла в открытом виде.
    refused = await api.client.post(
        "/api/v1/messages/attachment/",
        params={
            "chat_id": chat_id,
            "filename": "enc_deadbeef.bin",
            "caption": "e2ee1:aaaa:bbbb",
            "encrypted": "true",
        },
        content=b"\x00fake-ciphertext",
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )
    assert refused.status_code == 400

    # После включения E2EE тот же запрос проходит, флаг сохраняется.
    enabled = await api.client.put(
        f"/api/v1/chats/{chat_id}/e2ee/",
        json={"enabled": True},
        headers=api.auth(token),
    )
    assert enabled.status_code == 200, enabled.text

    accepted = await api.client.post(
        "/api/v1/messages/attachment/",
        params={
            "chat_id": chat_id,
            "filename": "enc_deadbeef.bin",
            "caption": "e2ee1:aaaa:bbbb",
            "mime": "application/octet-stream",
            "encrypted": "true",
        },
        content=b"\x00fake-ciphertext",
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )
    assert accepted.status_code == 200, accepted.text
    body = accepted.json()
    assert body["encrypted"] is True
    # Настоящее имя файла сервер не знает — на диске нейтральное.
    assert body["file"]["name"] == "enc_deadbeef.bin"
    assert body["file"]["mime"] == "application/octet-stream"


# --- Контакты («записная книжка») -----------------------------------------


async def test_contacts_add_rename_and_list(api: _ApiCtx) -> None:
    """Контакт добавляется, переименовывается и виден только владельцу."""
    owner = await api.make_user()
    peer = await api.make_user()
    owner_token = await api.token_for(owner)

    created = await api.client.put(
        f"/api/v1/contacts/{peer.id}/",
        json={"custom_name": "  Мама  "},
        headers=api.auth(owner_token),
    )
    assert created.status_code == 200, created.text
    body = created.json()
    # Имя хранится без лишних пробелов, данные человека — полные.
    assert body["custom_name"] == "Мама"
    assert body["user"]["id"] == peer.id
    assert body["user"]["username"] == peer.username

    listed = await api.client.get("/api/v1/contacts/", headers=api.auth(owner_token))
    assert listed.status_code == 200, listed.text
    assert [item["user"]["id"] for item in listed.json()] == [peer.id]
    assert listed.json()[0]["custom_name"] == "Мама"

    # Повторный PUT — это переименование, а не дубликат.
    renamed = await api.client.put(
        f"/api/v1/contacts/{peer.id}/",
        json={"custom_name": "Мамуля"},
        headers=api.auth(owner_token),
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["custom_name"] == "Мамуля"
    listed = await api.client.get("/api/v1/contacts/", headers=api.auth(owner_token))
    assert len(listed.json()) == 1

    # Пустое имя — сброс псевдонима (показывается обычное имя из профиля).
    cleared = await api.client.put(
        f"/api/v1/contacts/{peer.id}/",
        json={"custom_name": "   "},
        headers=api.auth(owner_token),
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["custom_name"] is None


async def test_contact_is_private_to_owner(api: _ApiCtx) -> None:
    """Записная книжка односторонняя: собеседник не видит запись о себе."""
    owner = await api.make_user()
    peer = await api.make_user()
    owner_token = await api.token_for(owner)
    peer_token = await api.token_for(peer)

    await api.client.put(
        f"/api/v1/contacts/{peer.id}/",
        json={"custom_name": "Сосед"},
        headers=api.auth(owner_token),
    )

    peer_list = await api.client.get("/api/v1/contacts/", headers=api.auth(peer_token))
    assert peer_list.status_code == 200, peer_list.text
    assert peer_list.json() == []


async def test_contacts_reject_self_and_unknown_user(api: _ApiCtx) -> None:
    """Себя в контакты не добавить; несуществующий пользователь — 404."""
    owner = await api.make_user()
    token = await api.token_for(owner)

    itself = await api.client.put(
        f"/api/v1/contacts/{owner.id}/",
        json={"custom_name": "Я"},
        headers=api.auth(token),
    )
    assert itself.status_code == 400, itself.text

    unknown = await api.client.put(
        "/api/v1/contacts/999999/",
        json={"custom_name": "Никто"},
        headers=api.auth(token),
    )
    assert unknown.status_code == 404, unknown.text


async def test_contact_delete_keeps_chat(api: _ApiCtx) -> None:
    """Удаление из контактов не удаляет переписку."""
    owner = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(owner)
    chat = await api.private_chat(token, peer.id)

    await api.client.put(
        f"/api/v1/contacts/{peer.id}/",
        json={"custom_name": "Друг"},
        headers=api.auth(token),
    )
    removed = await api.client.delete(
        f"/api/v1/contacts/{peer.id}/", headers=api.auth(token)
    )
    assert removed.status_code == 204, removed.text

    listed = await api.client.get("/api/v1/contacts/", headers=api.auth(token))
    assert listed.json() == []

    # Повторное удаление — тоже 204 (идемпотентно).
    again = await api.client.delete(
        f"/api/v1/contacts/{peer.id}/", headers=api.auth(token)
    )
    assert again.status_code == 204, again.text

    chats = await api.client.get("/api/v1/chats/", headers=api.auth(token))
    assert chat["id"] in [item["id"] for item in chats.json()]


async def test_contacts_write_is_rate_limited(api: _ApiCtx) -> None:
    """Запись в записную книжку ограничена по частоте (защита от спама)."""
    owner = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(owner)
    limit = settings.contact_write_limit_per_minute

    codes = []
    for _ in range(limit + 1):
        response = await api.client.put(
            f"/api/v1/contacts/{peer.id}/",
            json={"custom_name": "Спам"},
            headers=api.auth(token),
        )
        codes.append(response.status_code)

    assert codes[:limit] == [200] * limit
    assert codes[-1] == 429


async def test_message_timestamp_is_explicitly_utc(api: _ApiCtx) -> None:
    """Время сообщения приходит с явным смещением UTC.

    Колонка «timestamp without time zone» отдавалась как ``2026-09-10T18:59:11``
    без смещения — и браузер трактовал это как ЛОКАЛЬНОЕ время: в UTC+3
    сообщение показывалось на три часа раньше отправленного (чаты, разделители
    дней, «вчера/сегодня»). Теперь сервер помечает такое время как UTC, и клиент
    сам переводит его в пояс устройства.
    """
    from datetime import datetime

    u1 = await api.make_user()
    u2 = await api.make_user()
    token = await api.token_for(u1)
    chat = await api.private_chat(token, u2.id)
    await api.send(token, chat["id"], "проверка времени")

    messages = await api.list_messages(token, chat["id"])
    raw = messages[-1]["timestamp"]
    assert raw.endswith("+00:00") or raw.endswith("Z"), raw
    parsed = datetime.fromisoformat(raw)
    assert parsed.tzinfo is not None, raw
    assert parsed.utcoffset() is not None and parsed.utcoffset().total_seconds() == 0
