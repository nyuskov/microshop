"""Мост realtime-событий между процессами (RabbitMQ).

Проблема: живые WebSocket-соединения (события мессенджера, сигналинг звонков)
живут в конкретном процессе web — в его памяти. Значит событие, отправленное в
одном процессе, не найдёт абонента, подключённого к другому: Celery-воркер
вообще не имеет сокетов, а при нескольких процессах web (деплой «синий/зелёный»,
масштабирование) звонок не соединяется, а сообщения «не приходят».

Решение — мост через RabbitMQ:

* любой процесс (web или Celery-воркер) публикует событие в обмен
  ``settings.events_exchange`` (fanout) с полем ``recipient_ids``;
* каждый процесс web держит единственного потребителя
  (``RealtimeBridgeConsumer``), который читает очередь и раздаёт событие своим
  живым сокетам: события мессенджера — в ``events_manager``, сигналинг звонков —
  в ``call_manager`` (см. ``api_v1/events/bridge.py``).

Дублей нет: в теле события есть метка процесса-отправителя (``origin``), и свой
же событие, вернувшееся из fanout, процесс отбрасывает — он уже раздал его
локально при отправке. Повторную доставку (at-least-once) отсекаем по
``event_id``.

Для сигналинга звонков есть подтверждение доставки: отправитель просит ack
(``ack_requested``) и ждёт его (``wait_for_delivery``). Без подтверждения нельзя
решить главный вопрос — абонент офлайн или просто «в другом процессе»: в первом
случае вызов надо парковать, во втором — нет.
"""

import asyncio
import json
import logging
import os
import socket
import time
from collections import deque
from typing import Any
from uuid import uuid4

import aio_pika

from core.config import settings

logger = logging.getLogger(__name__)

# Типы событий, которые воркер может публиковать в мост.
EVENT_MESSAGE_NEW = "message.new"
# Пульс присутствия: процесс сообщает другим, кто из его сокетов «у экрана».
# Присутствие нельзя хранить в БД: «у экрана» — это состояние живого сокета, а
# сокеты есть только у своего процесса (см. `api_v1/events/bridge.py`).
EVENT_PRESENCE_HEARTBEAT = "presence-heartbeat"
# Подтверждение доставки: получатель сообщает отправителю, что раздал событие
# в свой живой сокет. Нужно, чтобы отправитель знал, доставлять ли повторно
# (через парковку или очередь) — при нескольких процессах web это иначе угадать
# нельзя. См. `wait_for_delivery`.
EVENT_DELIVERY_ACK = "delivery-ack"

# Сколько ждём подтверждение доставки. Меньше — рискуем не успеть получить ack
# (сеть до RabbitMQ плюс раздача в сокет), больше — задерживаем зовущего.
DELIVERY_ACK_TIMEOUT_SECONDS = 1.0

# Таймауты публикации. Мост — добавка к локальной доставке, и если брокер
# недоступен, событие уже ушло своим сокетам: ждать нельзя, HTTP-запрос не должен
# висеть. `connect_robust` сам по себе пытается переподключаться бесконечно,
# поэтому ограничиваем и подключение, и публикацию.
CONNECT_TIMEOUT_SECONDS = 0.5
PUBLISH_TIMEOUT_SECONDS = 0.5

# Предохранитель: после неудачной публикации не пытаемся снова несколько секунд.
# Иначе каждый запрос платил бы таймаут за заведомо мёртвый брокер, а в логах был
# бы поток одинаковых ошибок. Локальная доставка при этом работает.
BROKER_RETRY_COOLDOWN_SECONDS = 5.0


def process_origin() -> str:
    """Идентификатор этого процесса web (для отсечения своих же событий).

    Мост — fanout: каждый процесс получает КАЖДОЕ событие, включая то, которое
    опубликовал сам. Без метки отправителя свой же сигнал доставился бы дважды
    (локально и из очереди) — например, звонок получил бы два `call-answer`.
    """
    global _PROCESS_ORIGIN
    if _PROCESS_ORIGIN is None:
        _PROCESS_ORIGIN = f"{socket.gethostname()}-{os.getpid()}-{uuid4().hex[:8]}"
    return _PROCESS_ORIGIN


_PROCESS_ORIGIN: str | None = None
#: Ожидаемые подтверждения доставки: event_id -> Future[bool].
_pending_acks: dict[str, asyncio.Future[bool]] = {}
#: Сколько последних event_id помним для отсечения повторной доставки.
_SEEN_EVENTS_LIMIT = 512
_seen_events: deque[str] = deque(maxlen=_SEEN_EVENTS_LIMIT)


async def publish_realtime_event(
    payload: dict[str, Any],
    recipient_ids: list[int],
    *,
    ack_requested: bool = False,
) -> str:
    """Публикует realtime-событие в обмен моста (web или Celery-воркер).

    ``recipient_ids`` — id пользователей (кому раздать событие). Конвертация в
    строки намеренная: JSON-safe и удобно для отладки.

    Возвращает ``event_id``: по нему можно дождаться подтверждения доставки
    (``wait_for_delivery``). ``ack_requested=True`` просим получателей ответить,
    доставлено ли событие в живой сокет.
    """
    event_id = uuid4().hex
    body = {
        "type": payload.get("type", EVENT_MESSAGE_NEW),
        **{k: v for k, v in payload.items() if k != "type"},
        "recipient_ids": [str(user_id) for user_id in recipient_ids],
        "event_id": event_id,
        # Метка отправителя: свой же процесс игнорирует своё событие из очереди.
        "origin": process_origin(),
    }
    if ack_requested:
        body["ack_requested"] = True
    if _broker_in_cooldown():
        # Брокер только что был недоступен: не тратим таймаут на каждое событие.
        # Локальная доставка уже сделана вызывающим (см. `dispatch_realtime`).
        return event_id
    await _publish_body(body)
    return event_id


def _broker_in_cooldown() -> bool:
    """Недоступен ли брокер прямо сейчас (по недавней неудаче)."""
    return time.monotonic() < _broker_unavailable_until


def _mark_broker_unavailable() -> None:
    """Запоминает, что публикация не удалась: пауза перед следующей попыткой."""
    global _broker_unavailable_until
    _broker_unavailable_until = time.monotonic() + BROKER_RETRY_COOLDOWN_SECONDS


#: До какого момента не пытаться публиковать (см. `_broker_in_cooldown`).
_broker_unavailable_until = 0.0


async def _publish_body(body: dict[str, Any]) -> None:
    """Кладёт готовое тело в fanout-обмен моста.

    Канал публикации переиспользуется: события идут в горячем пути (каждое
    сообщение, каждый сигнал звонка), а открывать соединение с брокером на каждое
    событие — лишние миллисекунды и нагрузка. При обрыве канала один раз
    переподключаемся.
    """
    message = aio_pika.Message(
        body=json.dumps(body).encode("utf-8"),
        delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        content_type="application/json",
    )
    try:
        await asyncio.wait_for(_publish_once(message), PUBLISH_TIMEOUT_SECONDS)
        return
    except Exception as exc:  # noqa: BLE001 - возможно, канал умер: переподключаемся
        logger.warning("Realtime bridge: публикация не удалась (%s)", exc)
        await _reset_bridge_exchange()
    try:
        await asyncio.wait_for(_publish_once(message), PUBLISH_TIMEOUT_SECONDS)
    except Exception:
        # Обе попытки провалились — считаем брокер недоступным ненадолго:
        # иначе каждый запрос будет платить таймаут за мёртвое соединение.
        _mark_broker_unavailable()
        raise


async def _publish_once(message: aio_pika.Message) -> None:
    """Одна попытка публикации в уже готовый обмен."""
    exchange = await _bridge_exchange()
    await exchange.publish(message, routing_key="")


#: Канал публикации на процесс (ленивый, переиспользуется).
_shared_channel: aio_pika.abc.AbstractChannel | None = None
_shared_exchange: aio_pika.abc.AbstractExchange | None = None
_shared_lock = asyncio.Lock()


async def _reset_bridge_exchange() -> None:
    """Забывает канал публикации (после обрыва соединения)."""
    global _shared_channel, _shared_exchange
    channel = _shared_channel
    _shared_channel = None
    _shared_exchange = None
    if channel is not None and not channel.is_closed:
        try:
            await channel.close()
        except Exception:  # noqa: BLE001
            pass


async def _bridge_exchange() -> aio_pika.abc.AbstractExchange:
    """Возвращает общий обмен моста, создавая соединение при первом обращении."""
    global _shared_channel, _shared_exchange
    async with _shared_lock:
        if (
            _shared_exchange is not None
            and _shared_channel is not None
            and not _shared_channel.is_closed
        ):
            return _shared_exchange
        connection = await aio_pika.connect_robust(
            settings.rabbitmq_url, timeout=CONNECT_TIMEOUT_SECONDS
        )
        channel = await connection.channel()
        exchange = await channel.declare_exchange(
            settings.events_exchange,
            aio_pika.ExchangeType.FANOUT,
            durable=True,
        )
        _shared_channel = channel
        _shared_exchange = exchange
        return exchange


async def wait_for_delivery(event_id: str, timeout: float | None = None) -> bool:
    """Ждёт, пока хоть один процесс раздаст событие в живой сокет.

    Возвращает ``False`` по таймауту — это и есть признак «абонент офлайн»,
    по которому вызывающий паркует вызов или придерживает сигнал.
    """
    loop = asyncio.get_running_loop()
    future: asyncio.Future[bool] = loop.create_future()
    _pending_acks[event_id] = future
    try:
        return await asyncio.wait_for(
            future, timeout if timeout is not None else DELIVERY_ACK_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError:
        return False
    finally:
        _pending_acks.pop(event_id, None)


def _resolve_delivery_ack(event_id: str, delivered: bool) -> None:
    """Отмечает ожидание доставки (вызывает потребитель при получении ack)."""
    future = _pending_acks.get(event_id)
    if future is not None and not future.done():
        future.set_result(delivered)


async def _publish_delivery_ack(event_id: str, ack_origin: str) -> None:
    """Сообщает отправителю, что событие разошлось по живым сокетам.

    Публикуем в тот же fanout: ack увидят все процессы, но отзовётся только тот,
    чей ``origin`` совпадает с ``ack_origin`` (см. ``_handle_message``).
    """
    try:
        await _publish_body(
            {
                "type": EVENT_DELIVERY_ACK,
                "event_id": event_id,
                "ack_origin": ack_origin,
                "origin": process_origin(),
            }
        )
    except Exception:  # noqa: BLE001 - без ack событие просто придержат
        logger.exception("Realtime bridge: не удалось отправить подтверждение")


class RealtimeBridgeConsumer:
    """Потребитель realtime-событий моста внутри web-процесса.

    Читает очередь (привязанную к fanout-обмену ``events_exchange``) и
    передаёт каждое событие в callback ``on_event(user_ids, payload)``, который
    в web умеет раздать его в живые сокеты.
    """

    def __init__(self, on_event: Any) -> None:
        #: `on_event(user_ids, payload) -> bool` — доставлено ли хоть в один сокет.
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
            payload = {
                k: v
                for k, v in body.items()
                if k not in ("recipient_ids", "origin", "ack_requested", "ack_origin")
            }
            event_id = str(body.get("event_id") or "")
            origin = body.get("origin")
            ack_origin = body.get("ack_origin")
            ack_requested = bool(body.get("ack_requested"))
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

        # Подтверждение доставки от другого процесса: отзывается только тот, кто
        # ждёт (его `origin` записан в `ack_origin`), остальные молча проходят.
        if payload.get("type") == EVENT_DELIVERY_ACK:
            if ack_origin == process_origin() and event_id:
                _resolve_delivery_ack(event_id, True)
            return

        # Своё же событие вернулось из fanout: в этом процессе его уже раздали при
        # отправке, второй раз доставлять нельзя (звонок получил бы два ответа).
        if origin == process_origin():
            return

        # Повторная доставка (at-least-once) не должна дублировать событие.
        if event_id and event_id in _seen_events:
            return
        if event_id:
            _seen_events.append(event_id)

        if not recipient_ids:
            return
        delivered = False
        try:
            delivered = bool(await self._on_event(recipient_ids, payload))
        except Exception:  # noqa: BLE001 - ошибка раздачи в сокеты не критична
            logger.exception("Realtime bridge: ошибка раздачи события в сокеты")

        if delivered and ack_requested and event_id and origin:
            # Подтверждение адресуем метке процесса, который опубликовал сигнал:
            # он ждёт ответа в `wait_for_delivery`.
            await _publish_delivery_ack(event_id, str(origin))

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
