"""Мост realtime-событий: доставка между процессами web (этап B6).

Зачем: сокеты живут в конкретном процессе web. Пока процесс один, это незаметно;
при двух (деплой «синий/зелёный», масштабирование) событие, отправленное в одном
процессе, не находило абонента в другом — звонок не соединялся, «печатает…» и
presence не доходили, а сообщения приходили только по перезагрузке.

Здесь проверяется сама механика моста:

* событие уходит в обмен с меткой процесса (`origin`) и номером (`event_id`);
* потребитель отбрасывает своё же событие — иначе звонок получал бы два ответа;
* повторная доставка (at-least-once) отсекается по `event_id`;
* сигналинг звонков раздаётся в `call_manager`, остальное — в `events_manager`;
* подтверждение доставки (`ack`) приходит отправителю и решает, парковать ли вызов.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from core import amqp


class FakeMessage:
    """Минимальное входящее сообщение aio_pika для теста потребителя."""

    def __init__(self, body: dict[str, Any]) -> None:
        self.body = json.dumps(body).encode("utf-8")
        self.acked = False
        self.rejected = False

    async def ack(self) -> None:
        self.acked = True

    async def reject(self, requeue: bool = False) -> None:
        self.rejected = True


@pytest.fixture(autouse=True)
def clean_bridge_state() -> None:
    """Чистим общее состояние модуля между тестами (дедуп, ожидания, предохранитель)."""
    amqp._seen_events.clear()
    amqp._pending_acks.clear()
    amqp._broker_unavailable_until = 0.0
    yield
    amqp._seen_events.clear()
    amqp._pending_acks.clear()
    amqp._broker_unavailable_until = 0.0


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Перехватывает публикации: реальный RabbitMQ в тестах не нужен."""
    sent: list[dict[str, Any]] = []

    async def fake_publish(body: dict[str, Any]) -> None:
        sent.append(body)

    monkeypatch.setattr(amqp, "_publish_body", fake_publish)
    return sent


async def test_publish_adds_origin_and_event_id(
    published: list[dict[str, Any]],
) -> None:
    """Событие уходит с меткой процесса и номером — без них не отсечь дубли."""
    event_id = await amqp.publish_realtime_event({"type": "message.new"}, [7])
    assert event_id
    body = published[-1]
    assert body["origin"] == amqp.process_origin()
    assert body["event_id"] == event_id
    assert body["recipient_ids"] == ["7"]
    assert "ack_requested" not in body


async def test_publish_marks_ack_request_when_asked(
    published: list[dict[str, Any]],
) -> None:
    """Для сигналинга звонка просим подтверждение доставки."""
    await amqp.publish_realtime_event({"type": "call-offer"}, [7], ack_requested=True)
    assert published[-1]["ack_requested"] is True


async def test_consumer_skips_own_event(
    published: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Своё же событие из fanout не раздаём: локально оно уже ушло."""
    handled: list[Any] = []

    async def on_event(recipient_ids: list[int], payload: dict[str, Any]) -> bool:
        handled.append(payload)
        return True

    consumer = amqp.RealtimeBridgeConsumer(on_event)
    await consumer._handle_message(
        FakeMessage(  # type: ignore[arg-type]
            {
                "type": "call-answer",
                "recipient_ids": ["7"],
                "origin": amqp.process_origin(),
            }
        )
    )
    assert handled == []


async def test_consumer_delivers_and_answers_ack(
    published: list[dict[str, Any]],
) -> None:
    """Раздача в сокет подтверждается отправителю (иначе вызов запаркуют зря)."""
    handled: list[dict[str, Any]] = []

    async def on_event(recipient_ids: list[int], payload: dict[str, Any]) -> bool:
        handled.append(payload)
        return True

    consumer = amqp.RealtimeBridgeConsumer(on_event)
    message = FakeMessage(
        {
            "type": "call-offer",
            "call_id": "call-1",
            "recipient_ids": ["7"],
            "event_id": "evt-1",
            "origin": "another-process",
            "ack_requested": True,
        }
    )
    await consumer._handle_message(message)  # type: ignore[arg-type]

    assert message.acked is True
    assert handled[0]["type"] == "call-offer"
    ack = published[-1]
    assert ack["type"] == amqp.EVENT_DELIVERY_ACK
    assert ack["event_id"] == "evt-1"
    assert ack["ack_origin"] == "another-process"


async def test_consumer_skips_ack_when_nothing_delivered(
    published: list[dict[str, Any]],
) -> None:
    """Не доставили — молчим: отправитель по молчанию поймёт, что абонент офлайн."""

    async def on_event(recipient_ids: list[int], payload: dict[str, Any]) -> bool:
        return False

    consumer = amqp.RealtimeBridgeConsumer(on_event)
    await consumer._handle_message(
        FakeMessage(  # type: ignore[arg-type]
            {
                "type": "call-offer",
                "recipient_ids": ["7"],
                "event_id": "evt-2",
                "origin": "another-process",
                "ack_requested": True,
            }
        )
    )
    assert published == []


async def test_consumer_ignores_repeated_event() -> None:
    """Повторная доставка того же события не раздаётся второй раз."""
    calls: list[str] = []

    async def on_event(recipient_ids: list[int], payload: dict[str, Any]) -> bool:
        calls.append(str(payload.get("type")))
        return True

    body = {
        "type": "message.new",
        "recipient_ids": ["7"],
        "event_id": "evt-3",
        "origin": "another-process",
    }
    consumer = amqp.RealtimeBridgeConsumer(on_event)
    await consumer._handle_message(FakeMessage(body))  # type: ignore[arg-type]
    await consumer._handle_message(FakeMessage(body))  # type: ignore[arg-type]
    assert calls == ["message.new"]


async def test_delivery_ack_resolves_wait(
    published: list[dict[str, Any]],
) -> None:
    """Получив ack со своим origin, ожидание доставки завершается успешно."""

    async def on_event(recipient_ids: list[int], payload: dict[str, Any]) -> bool:
        return True

    consumer = amqp.RealtimeBridgeConsumer(on_event)
    waiter = asyncio.create_task(amqp.wait_for_delivery("evt-4", timeout=1.0))
    # Даём задаче поставить ожидание в очередь.
    await asyncio.sleep(0)

    await consumer._handle_message(
        FakeMessage(  # type: ignore[arg-type]
            {
                "type": amqp.EVENT_DELIVERY_ACK,
                "event_id": "evt-4",
                "ack_origin": amqp.process_origin(),
                "origin": "another-process",
            }
        )
    )
    assert await waiter is True


async def test_delivery_ack_for_other_process_is_ignored() -> None:
    """Чужое подтверждение не завершает наше ожидание."""

    async def on_event(recipient_ids: list[int], payload: dict[str, Any]) -> bool:
        return True

    consumer = amqp.RealtimeBridgeConsumer(on_event)
    waiter = asyncio.create_task(amqp.wait_for_delivery("evt-5", timeout=0.05))
    await asyncio.sleep(0)
    await consumer._handle_message(
        FakeMessage(  # type: ignore[arg-type]
            {
                "type": amqp.EVENT_DELIVERY_ACK,
                "event_id": "evt-5",
                "ack_origin": "some-other-process",
                "origin": "another-process",
            }
        )
    )
    # Ожидание истекает по таймауту: это и есть признак «абонент офлайн».
    assert await waiter is False


async def test_bridge_routes_calls_to_call_manager(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Сигналинг звонков идёт в call_manager, события чатов — в events_manager."""
    from api_v1.calls import manager as calls_manager
    from api_v1.events import bridge

    delivered: list[tuple[int, dict[str, Any]]] = []
    broadcast: list[list[int]] = []

    async def fake_call_send(user_id: int, payload: dict[str, Any]) -> bool:
        delivered.append((user_id, payload))
        return True

    async def fake_broadcast(user_ids: list[int], payload: dict[str, Any]) -> bool:
        broadcast.append(user_ids)
        return True

    monkeypatch.setattr(calls_manager.call_manager, "send_to_user", fake_call_send)
    monkeypatch.setattr(bridge.events_manager, "broadcast", fake_broadcast)

    assert await bridge._on_event([7], {"type": "call-offer", "call_id": "c1"}) is True
    assert delivered and delivered[0][0] == 7
    assert broadcast == []

    assert await bridge._on_event([7], {"type": "message.new"}) is True
    assert broadcast == [[7]]
