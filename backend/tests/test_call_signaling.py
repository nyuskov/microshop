"""Тесты «белого списка» сигнальных сообщений звонков.

Сервер — ретранслятор: он пропускает только типы из ``RELAY_MESSAGE_TYPES``.
Если новый тип клиента (например, пересогласование SDP для демонстрации экрана)
забыть добавить в набор, фронтенд молча перестанет получать сообщения — тест
фиксирует этот контракт.
"""

import time

import pytest

from api_v1.calls.views import RELAY_MESSAGE_TYPES, _track_call_event


def test_relay_whitelist_covers_call_flow() -> None:
    """Базовые шаги звонка + пересогласование/демонстрация экрана пересылаются."""
    required = {
        "call-offer",
        "call-answer",
        "ice-candidate",
        "call-cancel",
        "call-decline",
        "call-end",
    }
    assert required <= RELAY_MESSAGE_TYPES


def test_relay_whitelist_covers_screen_share() -> None:
    """Демонстрация экрана требует пересогласования SDP и статуса показа."""
    screen_share = {
        "call-renegotiate",
        "call-renegotiate-answer",
        "call-screen",
    }
    assert screen_share <= RELAY_MESSAGE_TYPES


async def test_track_call_event_ignores_unknown_types() -> None:
    """Новые типы не должны ломать запись истории звонков (и не создавать её)."""
    # Пересогласование приходит с чужим/отсутствующим call_id — обработчик обязан
    # молча выйти, а не упасть.
    await _track_call_event("call-screen", 1, 2, {"sharing": True})
    await _track_call_event("call-renegotiate", 1, 2, {"call_id": "unknown"})
    await _track_call_event("call-renegotiate-answer", 1, 2, {"call_id": "unknown"})


async def test_call_push_skipped_when_call_already_over(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Push о звонке ставим только пока вызов «висит».

    Иначе человек получал уведомление «Вам звонят» о звонке, который уже
    отменён (зовущий передумал) или принят (абонент сам открыл приложение и
    забрал припаркованный offer).
    """
    from api_v1.calls import views as calls_views
    from api_v1.calls.manager import call_manager

    sent: list[tuple] = []

    class _FakeTask:
        def delay(self, *args: object) -> None:
            sent.append(args)

    monkeypatch.setattr(calls_views, "CALL_PUSH_DELAY_SECONDS", 0)
    # Задачу берём из очереди по имени — подменяем точку входа Celery.
    monkeypatch.setattr("core.celery_app.get_task", lambda name: _FakeTask())

    offer = {"type": "call-offer", "call_id": "call-1", "kind": "audio"}

    # 1. Вызов ждёт ответа — push ставим в очередь.
    await call_manager.park_offer(7, dict(offer))
    await calls_views._enqueue_call_push_when_ringing(
        callee_id=7, caller_id=5, offer=offer
    )
    assert len(sent) == 1
    assert sent[0][0] == 7
    assert sent[0][1] == "call-1"
    # Срок годности уезжает в задачу: поздно доставленный push не показываем.
    assert isinstance(sent[0][4], int)

    # 2. Зовущий отменил звонок — уведомление уже не нужно.
    await call_manager.discard_pending_offer(7, "call-1")
    await calls_views._enqueue_call_push_when_ringing(
        callee_id=7, caller_id=5, offer=offer
    )
    assert len(sent) == 1

    # 3. Абонент подключился и забрал offer — тоже не шлём.
    await call_manager.park_offer(7, dict(offer))
    await call_manager.take_pending_offer(7)
    await calls_views._enqueue_call_push_when_ringing(
        callee_id=7, caller_id=5, offer=offer
    )
    assert len(sent) == 1


async def test_has_pending_offer_filters_by_call_id() -> None:
    """Парковка проверяется по конкретному вызову (и не путает разные звонки)."""
    from api_v1.calls.manager import call_manager

    await call_manager.park_offer(9, {"call_id": "call-a"})
    assert await call_manager.has_pending_offer(9, "call-a") is True
    assert await call_manager.has_pending_offer(9, "call-b") is False
    assert await call_manager.has_pending_offer(9) is True
    await call_manager.discard_pending_offer(9, "call-a")


def test_call_push_expiry() -> None:
    """Просроченный push о звонке не отправляем вовсе."""
    from tasks import notifications

    now_ms = int(time.time() * 1000)
    assert notifications._call_push_expired(None) is False
    assert notifications._call_push_expired(now_ms + 5_000) is False
    assert notifications._call_push_expired(now_ms - 1) is True
