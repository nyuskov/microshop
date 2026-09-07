"""Мост realtime-событий между Celery-воркером и web-процессом (RabbitMQ).

Проблема: живые WebSocket-соединения событийного канала (presence, message.new
и т.п.) живут в процессах web (см. ``api_v1.events.manager``). Когда фоновую
задачу исполняет отдельный Celery-воркер, он физически не может раздать событие
в эти сокеты — у него их нет.

Решение — мост через RabbitMQ:

* worker публикует лёгкое событие в обмен ``settings.events_exchange``
  (`fanout`) с полем ``recipient_ids`` (кому раздать);
* каждый процесс web держит единственного потребителя
  (``RealtimeBridgeConsumer``), который читает очередь и раздаёт событие в свои
  живые сокеты через общий in-process ``events_manager``.

Если web на несколько реплик — каждая слушает свою копию очереди и раздаёт
событие только тем сокетам, которые держит она; дублей среди разных реплик нет,
т.к. у каждой реплики свой набор подключений.
"""

import asyncio
import json
import logging
from typing import Any

import aio_pika

from core.config import settings

logger = logging.getLogger(__name__)

# Типы событий, которые воркер может публиковать в мост.
EVENT_MESSAGE_NEW = "message.new"


async def publish_realtime_event(
    payload: dict[str, Any],
    recipient_ids: list[int],
) -> None:
    """Публикует realtime-событие в обмен моста (вызывается в воркере).

    ``recipient_ids`` — id пользователей (кому раздать событие). Конвертация в
    строки намеренная: JSON-safe и удобно для отладки.
    """
    body = {
        "type": payload.get("type", EVENT_MESSAGE_NEW),
        **{k: v for k, v in payload.items() if k != "type"},
        "recipient_ids": [str(user_id) for user_id in recipient_ids],
    }
    connection = await aio_pika.connect_robust(settings.rabbitmq_url)
    try:
        channel = await connection.channel()
        exchange = await channel.declare_exchange(
            settings.events_exchange,
            aio_pika.ExchangeType.FANOUT,
            durable=True,
        )
        await exchange.publish(
            aio_pika.Message(
                body=json.dumps(body).encode("utf-8"),
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                content_type="application/json",
            ),
            routing_key="",
        )
    finally:
        await connection.close()


class RealtimeBridgeConsumer:
    """Потребитель realtime-событий моста внутри web-процесса.

    Читает очередь (привязанную к fanout-обмену ``events_exchange``) и
    передаёт каждое событие в callback ``on_event(user_ids, payload)``, который
    в web умеет раздать его в живые сокеты.
    """

    def __init__(self, on_event: Any) -> None:
        self._on_event = on_event
        self._connection: aio_pika.abc.AbstractRobustConnection | None = None
        self._task: asyncio.Task | None = None
        self._stop = False
        self._retry_delay = 3  # сек между попытками подключения

    async def start(self) -> None:
        """Запускает фоновый (самовосстанавливающийся) потребитель очереди.

        Не блокирует старт web: если RabbitMQ ещё недоступен (быстрый старт в
        docker), цикл будет переподключаться в фоне, пока брокер не поднимется.
        """
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Realtime bridge: запущен фоновый просмотр очереди")

    async def _run_loop(self) -> None:
        while not self._stop:
            try:
                connection = await aio_pika.connect_robust(settings.rabbitmq_url)
            except Exception:  # noqa: BLE001 - брокер может быть ещё не готов
                if not self._stop:
                    logger.warning(
                        "Realtime bridge: брокер недоступен, повтор через %s c",
                        self._retry_delay,
                    )
                    await asyncio.sleep(self._retry_delay)
                continue

            self._connection = connection
            try:
                await self._consume_once(connection)
            except asyncio.CancelledError:
                await connection.close()
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("Realtime bridge: разрыв соединения (%s)", exc)
            finally:
                try:
                    await connection.close()
                except Exception:  # noqa: BLE001
                    pass
                self._connection = None
            if not self._stop:
                await asyncio.sleep(self._retry_delay)

    async def _consume_once(
        self, connection: aio_pika.abc.AbstractRobustConnection
    ) -> None:
        channel = await connection.channel()
        await channel.set_qos(prefetch_count=20)
        exchange = await channel.declare_exchange(
            settings.events_exchange, aio_pika.ExchangeType.FANOUT, durable=True
        )
        # Уникальная очередь на процесс web: если web несколько реплик, каждая
        # получает свою копию (fanout) и раздаёт события в свои сокеты.
        queue = await channel.declare_queue(
            f"{settings.events_queue}.{id(self)}", durable=False, exclusive=True
        )
        await queue.bind(exchange)
        logger.info("Realtime bridge: слушаю очередь %s", queue.name)
        async with queue.iterator() as consumer:
            async for message in consumer:
                if self._stop:
                    await message.reject(requeue=False)
                    break
                await self._handle_message(message)

    async def _handle_message(
        self, message: aio_pika.abc.AbstractIncomingMessage
    ) -> None:
        try:
            body = json.loads(message.body.decode("utf-8"))
            recipient_ids = [
                int(user_id)
                for user_id in body.get("recipient_ids", [])
                if str(user_id).lstrip("-").isdigit()
            ]
            payload = {k: v for k, v in body.items() if k not in ("recipient_ids",)}
            # Подтверждаем приём до раздачи: если раздача упадёт, сообщение уже
            # обработано (ack), повторная доставка не нужна.
            await message.ack()
        except Exception:  # noqa: BLE001 - не валим потребитель из-за битого сообщения
            logger.exception("Realtime bridge: ошибка чтения события")
            try:
                await message.reject(requeue=False)
            except Exception:  # noqa: BLE001
                pass
            return

        if not recipient_ids:
            return
        try:
            await self._on_event(recipient_ids, payload)
        except Exception:  # noqa: BLE001 - ошибка раздачи в сокеты не критична
            logger.exception("Realtime bridge: ошибка раздачи события в сокеты")

    async def stop(self) -> None:
        self._stop = True
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._connection is not None:
            try:
                await self._connection.close()
            except Exception:  # noqa: BLE001
                pass
