"""Мост realtime-событий в web-процессе.

Запускается при старте FastAPI (lifespan). Фоновый потребитель читает события,
которые публикует Celery-воркер (например, после создания GIF-сообщения), и
раздаёт их в живые WebSocket-соединения через общий in-process
``events_manager``. Так сохраняется realtime, даже когда источник события —
отдельный воркер.
"""

import logging
from typing import Any

from core.amqp import RealtimeBridgeConsumer

from .manager import events_manager

logger = logging.getLogger(__name__)

_consumer: RealtimeBridgeConsumer | None = None


async def _on_event(recipient_ids: list[int], payload: dict[str, Any]) -> None:
    """Раздаёт событие моста в живые сокеты нашего процесса."""
    await events_manager.broadcast(recipient_ids, payload)


async def start_bridge() -> None:
    """Запускает потребитель моста (при старте приложения)."""
    global _consumer
    if _consumer is not None:
        return
    _consumer = RealtimeBridgeConsumer(_on_event)
    await _consumer.start()


async def stop_bridge() -> None:
    """Останавливает потребитель моста (при завершении приложения)."""
    global _consumer
    if _consumer is None:
        return
    await _consumer.stop()
    _consumer = None
