"""Общие фикстуры для БД-тестов (нужен PostgreSQL: TEST_DATABASE_URL).

Схема создаётся миграциями alembic (в CI — отдельным шагом; локально —
``alembic upgrade head`` на тестовую БД). Между тестами данные очищаются
TRUNCATE, чтобы тесты не зависели друг от друга.
"""

import os

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.rate_limit import rate_limiter


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Сбрасывает лимитер между тестами.

    Он живёт в памяти процесса и общий для всех тестов: без сброса суточные
    лимиты кодов и лимиты «N запросов в минуту» протекали бы между тестами.
    """
    rate_limiter.reset()
    yield
    rate_limiter.reset()


@pytest_asyncio.fixture
async def db_engine():
    """Engine на TEST_DATABASE_URL (схема уже накатана alembic)."""
    if os.getenv("TEST_DATABASE_URL") is None:
        pytest.skip("TEST_DATABASE_URL не задан (нужен PostgreSQL)")
    engine = create_async_engine(os.environ["TEST_DATABASE_URL"])
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def session(db_engine):
    """AsyncSession поверх тестового движка; таблицы очищаются перед тестом."""
    async with db_engine.begin() as conn:
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

    factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with factory() as session:
        yield session


# ---------- Хранилище сигналинга звонков (таблицы в БД) ----------


@pytest_asyncio.fixture
async def call_signals(monkeypatch):
    """Тестовое хранилище парковки вызова и очереди сигналинга.

    Парковка и придержанные сообщения живут в БД (их должен видеть любой процесс
    web, см. `api_v1/calls/store.py`), а глобальный `db_helper` привязан к своему
    event loop — `pytest-asyncio` даёт каждому тесту новый. Поэтому подменяем
    фабрику сессий на движок этого теста и чистим таблицы.

    Возвращает объект с полями:

    * ``factory`` — фабрика сессий (нужна тестам, которые лезут в БД сами);
    * ``seed(ids)`` — создать пользователей: на `user` ссылаются внешние ключи
      парковки и очереди, поэтому запись без существующего абонента не пройдёт.
    """
    from types import SimpleNamespace

    from sqlalchemy import delete
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.models import PendingCallOffer, QueuedCallSignal, User, db_helper

    if os.getenv("TEST_DATABASE_URL") is None:
        pytest.skip("TEST_DATABASE_URL не задан (нужен PostgreSQL)")

    engine = create_async_engine(os.environ["TEST_DATABASE_URL"])
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(db_helper, "session_factory", factory)

    async def clear() -> None:
        async with factory() as session:
            await session.execute(delete(PendingCallOffer))
            await session.execute(delete(QueuedCallSignal))
            await session.commit()

    async def seed(ids) -> None:
        async with factory() as session:
            for user_id in ids:
                await session.execute(
                    pg_insert(User)
                    .values(
                        id=user_id,
                        username=f"call_sig_{user_id}",
                        hashed_password="x",
                        is_active=True,
                        is_superuser=False,
                        is_verified=False,
                    )
                    .on_conflict_do_nothing(index_elements=[User.id])
                )
            await session.commit()

    await clear()
    yield SimpleNamespace(factory=factory, seed=seed, clear=clear)
    await clear()
    await engine.dispose()
