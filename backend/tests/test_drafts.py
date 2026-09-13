"""HTTP-тесты черновиков сообщений.

Проверяем: сохранение и список, приватность (чужой черновик не видно), удаление
пустым текстом и через DELETE, отказ для чата, в котором пользователя нет, и
предел длины.

Запускаются только при заданном TEST_DATABASE_URL (как остальные БД-тесты;
схема накатывается alembic).
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

    async def make_user(self, *, username: str | None = None) -> User:
        async with self.factory() as session:
            user = User(
                username=username or f"user_{uuid.uuid4().hex[:10]}",
                hashed_password="x",
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

    async def put_draft(self, token: str, chat_id: int, body: str):
        return await self.client.put(
            f"/api/v1/drafts/{chat_id}/",
            json={"text": body},
            headers=self.auth(token),
        )

    async def list_drafts(self, token: str) -> list[dict]:
        response = await self.client.get("/api/v1/drafts/", headers=self.auth(token))
        assert response.status_code == 200, response.text
        return response.json()


@pytest_asyncio.fixture
async def api() -> _ApiCtx:
    """httpx-клиент поверх приложения с тестовой БД (таблицы чистятся до теста)."""
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
            from api_v1.auth import otp_storage
            from core.rate_limit import rate_limiter

            rate_limiter._windows.clear()
            otp_storage._verify_lockouts.clear()
            await engine.dispose()


async def test_draft_saved_and_listed(api: _ApiCtx) -> None:
    """Черновик сохраняется и возвращается в списке с текстом."""
    author = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(author)
    chat = await api.private_chat(token, peer.id)

    response = await api.put_draft(token, chat["id"], "недописанное сообщение")
    assert response.status_code == 200, response.text
    assert response.json()["text"] == "недописанное сообщение"

    drafts = await api.list_drafts(token)
    assert [(item["chat_id"], item["text"]) for item in drafts] == [
        (chat["id"], "недописанное сообщение")
    ]


async def test_draft_is_private_to_author(api: _ApiCtx) -> None:
    """Чужой черновик не видно: список отдаёт только свои."""
    author = await api.make_user()
    peer = await api.make_user()
    author_token = await api.token_for(author)
    peer_token = await api.token_for(peer)
    chat = await api.private_chat(author_token, peer.id)

    await api.put_draft(author_token, chat["id"], "моё недописанное")
    assert await api.list_drafts(peer_token) == []


async def test_empty_draft_removes_row(api: _ApiCtx) -> None:
    """Пустой текст и DELETE убирают черновик (в базе не остаётся строки)."""
    author = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(author)
    chat = await api.private_chat(token, peer.id)

    await api.put_draft(token, chat["id"], "черновик")
    assert len(await api.list_drafts(token)) == 1

    response = await api.put_draft(token, chat["id"], "   ")
    assert response.status_code == 200, response.text
    assert response.json() is None
    assert await api.list_drafts(token) == []

    await api.put_draft(token, chat["id"], "снова черновик")
    deleted = await api.client.delete(
        f"/api/v1/drafts/{chat['id']}/", headers=api.auth(token)
    )
    assert deleted.status_code == 204, deleted.text
    assert await api.list_drafts(token) == []


async def test_draft_in_foreign_chat_not_found(api: _ApiCtx) -> None:
    """В чужом чате черновик не сохранить: 404, как и у остальных чужих чатов."""
    author = await api.make_user()
    peer = await api.make_user()
    outsider = await api.make_user()
    token = await api.token_for(author)
    outsider_token = await api.token_for(outsider)
    chat = await api.private_chat(token, peer.id)

    response = await api.put_draft(outsider_token, chat["id"], "чужие дела")
    assert response.status_code == 404, response.text


async def test_too_long_draft_rejected(api: _ApiCtx) -> None:
    """Слишком длинный черновик сервер не принимает (422 от валидации)."""
    author = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(author)
    chat = await api.private_chat(token, peer.id)

    response = await api.put_draft(token, chat["id"], "я" * 4001)
    assert response.status_code == 422, response.text
