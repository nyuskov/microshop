"""Базовые утилиты Celery-воркера.

Celery-воркер исполняет задачи в синхронном процессе (prefork), тогда как код
проекта асинхронный (SQLAlchemy async + asyncpg). Каждая «тяжёлая» задача
запускает собственный цикл событий через ``asyncio.run`` (см. ``run_async``) и
работает с отдельным движком БД, созданным и закрытым внутри этого же цикла —
так избегаем проблемы «engine привязан к чужому event loop».
"""

import asyncio
from collections.abc import Awaitable
from typing import TypeVar

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from core.config import settings

_T = TypeVar("_T")


def run_async(coro: Awaitable[_T]) -> _T:
    """Выполняет асинхронную корутину в свежем цикле событий.

    Каждый вызов создаёт новый цикл — безопасно для Celery-воркера с пулом
    процессов (prefork), где постоянно работающего event loop нет.
    """
    return asyncio.run(coro)  # type: ignore[arg-type]


def make_engine() -> AsyncEngine:
    """Создаёт изолированный движок БД для одной Celery-задачи."""
    return create_async_engine(
        settings.db_url,
        echo=settings.db_echo,
        pool_pre_ping=True,
    )


def make_session(engine: AsyncEngine) -> AsyncSession:
    """Создаёт сессию для движка (с параметрами, близкими к web-процессу)."""
    factory = async_sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )
    return factory()
