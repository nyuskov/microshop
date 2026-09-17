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

import asyncio
import logging
from typing import Any

from core.amqp import (
    EVENT_PRESENCE_HEARTBEAT,
    RealtimeBridgeConsumer,
    publish_realtime_event,
)

from .manager import events_manager

logger = logging.getLogger(__name__)

_consumer: RealtimeBridgeConsumer | None = None
_heartbeat_task: asyncio.Task | None = None

#: Типы событий сигнального канала звонков (всё остальное — события мессенджера).
CALL_EVENT_PREFIX = "call-"

#: Как часто сообщать другим процессам, кто у нас «у экрана». Реже — статус
#: мигает; чаще — лишние события в мост (список id при этом короткий: только те,
#: кто сейчас в приложении).
PRESENCE_HEARTBEAT_SECONDS = 15.0


async def _on_event(recipient_ids: list[int], payload: dict[str, Any]) -> bool:
    """Раздаёт событие моста в живые сокеты нашего процесса.

    Возвращает ``True``, если событие ушло хотя бы в один сокет: по этому ответу
    отправитель понимает, что абонент на связи (см. `core.amqp.wait_for_delivery`),
    и не паркует вызов зря.
    """
    if payload.get("type") == EVENT_PRESENCE_HEARTBEAT:
        # Служебный пульс: клиентам он не нужен, только отмечаем чужое присутствие.
        events_manager.mark_remote_present(recipient_ids)
        return True
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
    global _consumer, _heartbeat_task
    if _consumer is not None:
        return
    _consumer = RealtimeBridgeConsumer(_on_event)
    await _consumer.start()
    _heartbeat_task = asyncio.create_task(_presence_heartbeat_loop())


async def stop_bridge() -> None:
    """Останавливает потребитель моста (при завершении приложения)."""
    global _consumer, _heartbeat_task
    if _heartbeat_task is not None:
        _heartbeat_task.cancel()
        try:
            await _heartbeat_task
        except asyncio.CancelledError:
            pass
        _heartbeat_task = None
    if _consumer is None:
        return
    await _consumer.stop()
    _consumer = None


async def _presence_heartbeat_loop() -> None:
    """Сообщает другим процессам, кто у НАС «у экрана».

    Присутствие нельзя вывести из общего хранилища: «у экрана» — это состояние
    живого сокета, а сокеты есть только у своего процесса. Поэтому каждый процесс
    периодически публикует список своих активных пользователей, а остальные
    держат его до TTL (см. `events_manager.mark_remote_present`). Пользователь
    при этом остаётся «в сети», даже если подключён к другому слоту `web`.
    """
    while True:
        await asyncio.sleep(PRESENCE_HEARTBEAT_SECONDS)
        present = events_manager.local_present_ids()
        if not present:
            continue
        try:
            await publish_realtime_event({"type": EVENT_PRESENCE_HEARTBEAT}, present)
        except Exception:  # noqa: BLE001 - пульс не должен ронять приложение
            logger.debug("Не удалось опубликовать пульс присутствия")
