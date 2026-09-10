"""Health-проверки: корневые и под `/api/v1` (их опрашивает мониторинг и CI).

Наружу на проде проксируется только `/api/`, поэтому `/api/v1/health` — это
единственный публично доступный способ узнать, что процесс и БД живы. Если
роутер отвалился, смоук-тест после деплоя должен это поймать, поэтому проверяем
и корневой путь (healthcheck docker), и проксируемый.
"""

from __future__ import annotations

import os

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.models import db_helper

pytestmark = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


@pytest_asyncio.fixture
async def client(monkeypatch):
    """HTTP-клиент к приложению; готовность проверяет БД тестового окружения."""
    from main import app

    engine = create_async_engine(os.environ["TEST_DATABASE_URL"])
    factory = async_sessionmaker(engine, expire_on_commit=False)
    # Роутер готовности берёт фабрику сессий из db_helper напрямую (не через
    # dependency), поэтому подменяем её на тестовую БД.
    monkeypatch.setattr(db_helper, "session_factory", factory)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    await engine.dispose()


@pytest.mark.parametrize("path", ["/health", "/api/v1/health"])
async def test_liveness_ok(client, path: str) -> None:
    resp = await client.get(path)
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


@pytest.mark.parametrize("path", ["/health/ready", "/api/v1/health/ready"])
async def test_readiness_ok_when_db_available(client, path: str) -> None:
    resp = await client.get(path)
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "database": "ok"}


async def test_readiness_reports_503_when_db_unreachable(monkeypatch) -> None:
    """Если БД недоступна, готовность отвечает 503 — по этому мониторинг
    понимает, что прод не может обслуживать запросы."""
    from main import app

    class _BrokenSession:
        async def __aenter__(self):
            raise RuntimeError("db is down")

        async def __aexit__(self, *exc_info):
            return False

    class _BrokenFactory:
        def __call__(self):
            return _BrokenSession()

    monkeypatch.setattr(db_helper, "session_factory", _BrokenFactory())

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        resp = await c.get("/api/v1/health/ready")

    assert resp.status_code == 503
    assert resp.json() == {"status": "error", "database": "unreachable"}


async def test_proxied_health_paths_exist() -> None:
    """Публичный путь обязан жить под `/api/` — только его проксирует nginx
    (корневой `/health` на проде отдаёт SPA-фолбэк с кодом 200)."""
    from main import app

    paths = {route.path for route in app.routes}  # type: ignore[attr-defined]
    assert "/api/v1/health" in paths
    assert "/api/v1/health/ready" in paths
    assert "/health" in paths
    assert "/health/ready" in paths
