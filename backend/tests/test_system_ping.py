"""Проверка маяка связи (``GET /api/v1/system/ping/``).

Маяк — самый частый запрос приложения: пока висит плашка «нет сети», клиент
дёргает его каждые 2 секунды. Поэтому у него два жёстких требования, и оба
здесь проверяются: он отвечает без авторизации и без обращения к базе (иначе
частый опрос бил бы по PostgreSQL, который может быть недоступен вместе с
остальным сервисом).
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio


async def test_ping_answers_without_auth() -> None:
    """Без токена и без базы (в тесте DATABASE_URL никто не подменяет)."""
    from main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/system/ping/")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["server_time"]


async def test_ping_works_during_maintenance(monkeypatch: pytest.MonkeyPatch) -> None:
    """Во время техработ маяк тоже отвечает: иначе клиент решит, что «нет сети»."""
    from core import maintenance

    async def _fake_current_state() -> maintenance.MaintenanceState:
        return maintenance.MaintenanceState(enabled=True, message="Обновляем сервис")

    monkeypatch.setattr(maintenance, "current_state", _fake_current_state)

    from main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/system/ping/")

    assert response.status_code == 200
