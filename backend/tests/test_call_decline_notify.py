"""Отказ из уведомления (смахивание/кнопка) должен гасить вызов у ЗОВУЩЕГО.

Симптом из жизни: абонент смахивает уведомление о звонке — у него вызов
прекращается, а у зовущего продолжает звонить, пока не сработает его собственный
таймаут.

Причина: отказ из уведомления приходит в REST-эндпоинт (`POST /calls/decline/`) и
доставляется зовущему «напрямую в сокет». Если сокет зовущего в этот момент мёртв
(приложение в фоне, смена сети) или сообщение попало в устаревший сокет, а окно,
которое звенит, его не обработало, зовущий так и продолжает звонить.

Теперь: сообщение придерживается до подключения (`queue_message`) и независимо от
этого зовущему уходит тихий push — service worker гасит уведомление и просит
приложение прекратить звонок (`callStore.finishIfRinging`).
"""

from __future__ import annotations

from typing import Any

import pytest

from api_v1.calls import views as calls_views
from api_v1.calls.views import CallDeclineRequest


class FakeCallManager:
    """Менеджер звонков: следит за отправкой, придержкой и снятием парковки."""

    def __init__(self, *, delivered: bool) -> None:
        self.delivered = delivered
        self.sent: list[tuple[int, dict[str, Any]]] = []
        self.queued: list[tuple[int, dict[str, Any], float | None]] = []
        self.discarded: list[tuple[int, str]] = []

    async def send_to_user(self, user_id: int, payload: dict[str, Any]) -> bool:
        self.sent.append((user_id, payload))
        return self.delivered

    async def queue_message(
        self, user_id: int, payload: dict[str, Any], ttl_seconds: float | None = None
    ) -> None:
        self.queued.append((user_id, payload, ttl_seconds))

    async def discard_pending_offer(self, user_id: int, call_id: str) -> None:
        self.discarded.append((user_id, call_id))


def _setup(
    monkeypatch: pytest.MonkeyPatch, *, delivered: bool
) -> tuple[FakeCallManager, list[tuple[int, str, str]], list[tuple[str, int, int]]]:
    """Подменяет менеджер, запись истории и push; возвращает наблюдателей."""
    manager = FakeCallManager(delivered=delivered)
    pushes: list[tuple[int, str, str]] = []
    tracked: list[tuple[str, int, int]] = []

    async def fake_track(
        message_type: str, from_user_id: int, to_user_id: int, data: dict
    ) -> None:
        tracked.append((message_type, from_user_id, to_user_id))

    def fake_notify(user_id: int, call_id: object, reason: str = "cancelled") -> None:
        pushes.append((user_id, str(call_id), reason))

    monkeypatch.setattr(calls_views, "call_manager", manager)
    monkeypatch.setattr(calls_views, "_track_call_event", fake_track)
    monkeypatch.setattr(calls_views, "_notify_call_finished", fake_notify)
    return manager, pushes, tracked


async def test_decline_queued_for_offline_caller(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Зовущий недоступен — отказ придерживаем до его подключения."""
    manager, pushes, tracked = _setup(monkeypatch, delivered=False)

    result = await calls_views.decline_call(
        CallDeclineRequest(call_id="call-1", to_user_id=7),
        user=type("U", (), {"id": 5})(),
    )

    assert result == {"ok": False}
    assert (
        7,
        {
            "type": "call-decline",
            "call_id": "call-1",
            "to_user_id": 7,
            "from_user_id": 5,
            "reason": "declined",
        },
        calls_views.CALL_OVER_QUEUE_TTL_SECONDS,
    ) in manager.queued
    # И тихий push — он дойдёт даже с мёртвым сокетом.
    assert (7, "call-1", "declined") in pushes
    # Свои устройства и история — как раньше.
    assert (5, "call-1", "declined") in pushes
    assert ("call-decline", 5, 7) in tracked
    # Своему устройству — завершение и по сигнальному каналу (сокет закрыт, уйдёт
    # из очереди при подключении).
    assert (
        5,
        {
            "type": "call-end",
            "call_id": "call-1",
            "to_user_id": 7,
            "from_user_id": 5,
            "reason": "declined",
        },
        calls_views.CALL_OVER_QUEUE_TTL_SECONDS,
    ) in manager.queued


async def test_decline_closes_own_ringing_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """У абонента окно звонка закрывается сразу, а не по таймауту.

    Смахивание убирает уведомление, но вызов в приложении продолжает «звонить»:
    push может не дойти (нет подписки, Doze), поэтому завершение уходит и по
    сигнальному каналу — как обычный `call-end`.
    """
    manager, _, _ = _setup(monkeypatch, delivered=True)

    await calls_views.decline_call(
        CallDeclineRequest(call_id="call-1", to_user_id=7),
        user=type("U", (), {"id": 5})(),
    )

    sent_to_self = [payload for user_id, payload in manager.sent if user_id == 5]
    assert sent_to_self == [
        {
            "type": "call-end",
            "call_id": "call-1",
            "to_user_id": 7,
            "from_user_id": 5,
            "reason": "declined",
        }
    ]


async def test_decline_still_pushes_when_socket_looks_alive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Сокет «принял», но окно могло не обработать — push зовущему всё равно нужен."""
    manager, pushes, _ = _setup(monkeypatch, delivered=True)

    result = await calls_views.decline_call(
        CallDeclineRequest(call_id="call-1", to_user_id=7),
        user=type("U", (), {"id": 5})(),
    )

    assert result == {"ok": True}
    assert manager.queued == []
    assert (7, "call-1", "declined") in pushes
