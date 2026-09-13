"""Общие фикстуры для БД-тестов (нужен PostgreSQL: TEST_DATABASE_URL).

Схема создаётся миграциями alembic (в CI — отдельным шагом; локально —
``alembic upgrade head`` на тестовую БД). Между тестами данные очищаются
TRUNCATE, чтобы тесты не зависели друг от друга.
"""

import os

import pytest
import pytest_asyncio
from sqlalchemy import text
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
