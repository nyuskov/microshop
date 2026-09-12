"""Присутствие: сервер должен точно знать, «в сети» человек или ушёл.

Симптомы из жизни:

1. собеседник уже закрыл приложение, а у нас он ещё «в сети» — раньше об уходе
   узнавали только по таймауту прокси (минуты);
2. статус сначала переключался на «был(а) только что», а потом сразу обратно на
   «в сети»: приложение в фоне переподключалось, и одно подключение считалось
   присутствием.

Теперь: подключение != «в сети». Клиент сразу присылает `activity` (у экрана или
свёрнуто), раз в 25 секунд шлёт `ping` (сервер закрывает молчащий канал через
`WS_IDLE_TIMEOUT_SECONDS`), при уходе со страницы — `bye`. Старым клиентам, не
умеющим `activity`, есть короткая страховка `WS_ACTIVITY_FALLBACK_SECONDS`.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from api_v1.events import views as events_views
from api_v1.events.manager import EventsConnectionManager


class FakeWebSocket:
    """Сокет, который «молчит», пока в очереди нет сообщений от клиента."""

    def __init__(self, messages: list[Any] | None = None, delay: float = 0.0) -> None:
        self._messages = list(messages or [])
        #: Пауза перед выдачей сообщения — чтобы проверить отложенные ветки.
        self.delay = delay
        self.closed_with: int | None = None

    async def receive_json(self) -> Any:
        if self._messages:
            if self.delay:
                await asyncio.sleep(self.delay)
            return self._messages.pop(0)
        # Молчание: ждём бесконечно — ровно то, что видит сервер от уснувшего
        # телефона.
        await asyncio.sleep(3600)

    async def accept(self) -> None:
        return None

    async def close(self, code: int = 1000) -> None:
        self.closed_with = code


class FakeSession:
    """Сессия-заглушка: сервер коммитит `last_seen` при уходе."""

    async def commit(self) -> None:
        return None

    async def __aenter__(self) -> FakeSession:
        return self

    async def __aexit__(self, *args: object) -> None:
        return None


class Presence:
    """Собирает рассылки присутствия; менеджер соединений — настоящий."""

    def __init__(self) -> None:
        self.broadcasts: list[tuple[int, bool]] = []
        self.manager = EventsConnectionManager()


@pytest.fixture
def presence(monkeypatch: pytest.MonkeyPatch) -> Presence:
    """Заглушки БД и рассылки; состояние соединений — как в бою."""
    state = Presence()

    async def fake_broadcast(
        peer_ids: list[int], user_id: int, *, online: bool, last_seen: object
    ) -> None:
        state.broadcasts.append((user_id, online))

    monkeypatch.setattr(events_views, "_broadcast_presence", fake_broadcast)
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
    monkeypatch.setattr(events_views, "events_manager", state.manager)
    return state


async def _run(websocket: FakeWebSocket) -> None:
    """Прогоняет канал до конца (тест не должен висеть на реальных таймаутах)."""
    await asyncio.wait_for(
        events_views.websocket_events(websocket),  # type: ignore[arg-type]
        timeout=2,
    )


async def test_idle_channel_closes_and_reports_offline(
    presence: Presence, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Молчащий канал (уснувший телефон) закрывается и даёт `presence offline`."""
    # Таймаут уменьшаем, чтобы тест не ждал минуту в реальном времени.
    monkeypatch.setattr(events_views, "WS_IDLE_TIMEOUT_SECONDS", 0.05)
    websocket = FakeWebSocket()

    await _run(websocket)

    assert websocket.closed_with == 1000
    assert (7, False) in presence.broadcasts


async def test_bye_reports_offline_before_timeout(
    presence: Presence, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Уход со страницы (`bye`) — «не в сети» сразу, без ожидания таймаута."""
    monkeypatch.setattr(events_views, "WS_IDLE_TIMEOUT_SECONDS", 30)
    websocket = FakeWebSocket([{"type": "bye"}])

    await _run(websocket)

    assert presence.broadcasts.count((7, False)) == 1


async def test_backgrounded_app_is_not_online(
    presence: Presence, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Свёрнутое приложение — «не в сети», даже если канал ещё открыт."""
    monkeypatch.setattr(events_views, "WS_IDLE_TIMEOUT_SECONDS", 30)
    monkeypatch.setattr(events_views, "WS_ACTIVITY_FALLBACK_SECONDS", 30)
    websocket = FakeWebSocket(
        [
            {"type": "activity", "active": True},
            {"type": "activity", "active": False},
            {"type": "bye"},
        ]
    )

    await _run(websocket)

    # Сначала человек был у экрана, потом свернул приложение — и собеседники
    # получают оба события.
    assert presence.broadcasts[:2] == [(7, True), (7, False)]


async def test_reconnect_while_hidden_does_not_turn_online(
    presence: Presence, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Переподключение свёрнутого приложения НЕ «включает» онлайн.

    Иначе у собеседника статус дёргается: «был(а) только что» -> «в сети».
    """
    monkeypatch.setattr(events_views, "WS_IDLE_TIMEOUT_SECONDS", 30)
    monkeypatch.setattr(events_views, "WS_ACTIVITY_FALLBACK_SECONDS", 30)
    websocket = FakeWebSocket([{"type": "activity", "active": False}, {"type": "bye"}])

    await _run(websocket)

    assert (7, True) not in presence.broadcasts


async def test_old_client_without_activity_shows_online(
    presence: Presence, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Старый клиент (без `activity`) считается «в сети» — как раньше."""
    monkeypatch.setattr(events_views, "WS_IDLE_TIMEOUT_SECONDS", 30)
    monkeypatch.setattr(events_views, "WS_ACTIVITY_FALLBACK_SECONDS", 0.05)
    # Сообщения приходят с паузой: старый клиент просто сидит на канале, и
    # страховка успевает сработать.
    websocket = FakeWebSocket([{"type": "typing"}, {"type": "bye"}], delay=0.15)

    await _run(websocket)

    assert (7, True) in presence.broadcasts
