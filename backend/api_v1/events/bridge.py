"""Мост realtime-событий в web-процессе.

Запускается при старте FastAPI (lifespan). Фоновый потребитель читает события,
которые публикует любой процесс (Celery-воркер — например, после создания
GIF-сообщения; или другой процесс web — когда его сокет не нашёлся, см.
`api_v1/events/service.dispatch_realtime`), и раздаёт их в живые WebSocket-
соединения ЭТОГО процесса. Так realtime работает и при нескольких процессах web:
каждый держит свои сокеты, а событие доходит туда, где абонент на связи.

Сигналинг звонков идёт тем же обменом, но раздаётся в `call_manager`: у звонка
отдельный WebSocket-канал, и события у него свои.
"""

import logging
from typing import Any

from core.amqp import RealtimeBridgeConsumer

from .manager import events_manager

logger = logging.getLogger(__name__)

_consumer: RealtimeBridgeConsumer | None = None

#: Типы событий сигнального канала звонков (всё остальное — события мессенджера).
CALL_EVENT_PREFIX = "call-"


async def _on_event(recipient_ids: list[int], payload: dict[str, Any]) -> bool:
    """Раздаёт событие моста в живые сокеты нашего процесса.

    Возвращает ``True``, если событие ушло хотя бы в один сокет: по этому ответу
    отправитель понимает, что абонент на связи (см. `core.amqp.wait_for_delivery`),
    и не паркует вызов зря.
    """
    if str(payload.get("type", "")).startswith(CALL_EVENT_PREFIX):
        # Импорт внутри функции: `api_v1.calls` тянет за собой модели и сигналинг,
        # а этот модуль импортируется при старте приложения.
        from api_v1.calls.manager import call_manager

        delivered = False
        for user_id in dict.fromkeys(recipient_ids):
            if await call_manager.send_to_user(user_id, payload):
                delivered = True
        return delivered
    return await events_manager.broadcast(recipient_ids, payload)


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
