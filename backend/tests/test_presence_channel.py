"""Присутствие: сервер должен быстро узнавать об уходе.

Симптом из жизни: собеседник уже закрыл приложение, а у нас он ещё «в сети».
Причина — молчащий сокет: если приложение убили или телефон уснул, соединение не
закрывается чисто, и сервер узнаёт об уходе только по таймауту прокси (минуты).

Теперь клиент шлёт `ping` раз в 25 секунд (см. `stores/realtime.ts`), а сервер
закрывает канал, который молчит дольше `WS_IDLE_TIMEOUT_SECONDS`, после чего
участникам общих чатов уходит `presence offline`. Плюс `bye` — мгновенный уход
при закрытии страницы.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from api_v1.events import views as events_views


class FakeWebSocket:
    """Сокет, который «молчит», пока в очереди нет сообщений от клиента."""

    def __init__(self, messages: list[Any] | None = None) -> None:
        self._messages = list(messages or [])
        self.closed_with: int | None = None

    async def receive_json(self) -> Any:
        if self._messages:
            return self._messages.pop(0)
        # Молчание: ждём бесконечно — ровно то, что видит сервер от уснувшего
        # телефона.
        await asyncio.sleep(3600)

    async def close(self, code: int = 1000) -> None:
        self.closed_with = code


class FakeSession:
    """Сессия-заглушка: в офлайн-ветке сервер коммитит `last_seen` сам."""

    async def commit(self) -> None:
        return None

    async def __aenter__(self) -> FakeSession:
        return self

    async def __aexit__(self, *args: object) -> None:
        return None


@pytest.fixture
def presence(monkeypatch: pytest.MonkeyPatch) -> dict[str, list[tuple[int, bool]]]:
    """Заглушки БД, менеджера соединений и рассылки присутствия."""
    broadcasts: dict[str, list[tuple[int, bool]]] = {"offline": []}
    online = {"value": True}
    monkeypatch.setattr(
        events_views, "_broadcast_presence", _record_broadcast(broadcasts)
    )
    monkeypatch.setattr(
        events_views,
        "db_helper",
        type("DB", (), {"session_factory": staticmethod(FakeSession)}),
    )

    async def fake_user(_session: object, _user_id: int) -> object:
        return type("U", (), {"id": 7, "last_seen": None})()

    async def fake_peers(_session: object, _user_id: int) -> list[int]:
        return [8]

    async def fake_touch(_user: object, _session: object) -> None:
        return None

    monkeypatch.setattr(events_views, "get_user_by_id", fake_user)
    monkeypatch.setattr(events_views, "presence_peer_ids", fake_peers)
    monkeypatch.setattr(events_views, "touch_last_seen", fake_touch)

    async def fake_resolve(_websocket: object) -> object:
        return type("U", (), {"id": 7})()

    monkeypatch.setattr(events_views, "resolve_user_from_websocket", fake_resolve)

    connected: list[object] = []

    async def fake_connect(user_id: int, websocket: object) -> None:
        connected.append(websocket)

    async def fake_disconnect(user_id: int, websocket: object) -> None:
        online["value"] = False

    monkeypatch.setattr(events_views.events_manager, "connect", fake_connect)
    monkeypatch.setattr(events_views.events_manager, "disconnect", fake_disconnect)
    monkeypatch.setattr(
        events_views.events_manager, "is_online", lambda _user_id: online["value"]
    )
    return broadcasts


def _record_broadcast(store: dict[str, list[tuple[int, bool]]]):
    async def _broadcast(
        peer_ids: list[int], user_id: int, *, online: bool, last_seen: object
    ) -> None:
        if not online:
            store["offline"].append((user_id, online))

    return _broadcast


async def test_idle_channel_closes_and_reports_offline(
    presence: dict[str, list[tuple[int, bool]]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Молчащий канал (уснувший телефон) закрывается и даёт `presence offline`."""
    # Таймаут уменьшаем, чтобы тест не ждал минуту в реальном времени.
    monkeypatch.setattr(events_views, "WS_IDLE_TIMEOUT_SECONDS", 0.05)
    websocket = FakeWebSocket()

    await events_views.websocket_events(websocket)  # type: ignore[arg-type]

    assert websocket.closed_with == 1000
    assert presence["offline"] == [(7, False)]


async def test_ping_keeps_channel_alive(
    presence: dict[str, list[tuple[int, bool]]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`ping` — признак жизни: с ним канал не закрывается по таймауту."""
    monkeypatch.setattr(events_views, "WS_IDLE_TIMEOUT_SECONDS", 0.2)
    websocket = FakeWebSocket([{"type": "ping"}, {"type": "bye"}])

    await events_views.websocket_events(websocket)  # type: ignore[arg-type]

    # Закрыли только из-за `bye`, а не по таймауту (то есть ping сработал).
    assert websocket.closed_with is None
    assert presence["offline"] == [(7, False)]


async def test_bye_reports_offline_before_timeout(
    presence: dict[str, list[tuple[int, bool]]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Уход со страницы (`bye`) — «не в сети» сразу, без ожидания таймаута."""
    monkeypatch.setattr(events_views, "WS_IDLE_TIMEOUT_SECONDS", 30)
    websocket = FakeWebSocket([{"type": "bye"}])

    await asyncio.wait_for(
        events_views.websocket_events(websocket),  # type: ignore[arg-type]
        timeout=1,
    )

    assert presence["offline"] == [(7, False)]
