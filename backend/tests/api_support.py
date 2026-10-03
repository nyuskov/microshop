"""Общая инфраструктура HTTP-тестов API: контекст, фикстура, хелперы.

Живёт отдельно от `test_messenger_api.py`, потому что этими же фикстурой и
хелперами пользуются ещё полтора десятка тестовых модулей (`test_chat_media.py`,
`test_stories_api.py`, `test_avatar_thumbs.py`, …): раньше они импортировали их из
теста мессенджера — файла на четыре с половиной тысячи строк, из-за чего импорт
тянул весь модуль. Здесь только инфраструктура, тестов нет.
"""

from __future__ import annotations

import os
import uuid

import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.models import User, db_helper


def _png(size: int = 64) -> bytes:
    """Небольшая настоящая PNG-картинка.

    Нужна там, где важны именно байты картинки («В стикеры»): стикер-хранилище
    принимает только картинку, причём разумного размера — 1×1 не подходит.
    """
    from io import BytesIO

    from PIL import Image

    buffer = BytesIO()
    Image.new("RGBA", (size, size), (200, 30, 30, 255)).save(buffer, format="PNG")
    return buffer.getvalue()


def _heic(size: int = 320) -> bytes:
    """Фото в HEIC — так снимает Samsung и iPhone по умолчанию."""
    from io import BytesIO

    from PIL import Image

    buffer = BytesIO()
    Image.new("RGB", (size, size), (200, 30, 30)).save(buffer, format="HEIF")
    return buffer.getvalue()


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
            from core.rate_limit import rate_limiter

            rate_limiter._windows.clear()
            otp_storage._verify_lockouts.clear()
            await engine.dispose()
