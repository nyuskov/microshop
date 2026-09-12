"""Менеджер WebSocket-подключений для сигналинга звонков.

Сервер выступает лишь ретранслятором сообщений WebRTC (SDP offer/answer,
ICE-candidates, отмена/сброс/завершение) между двумя участниками вызова.

Если вызываемый абонент офлайн (приложение закрыто), offer «паркуется»: когда он
подключится, offer доставится и звонок его дождётся. Если у абонента есть push-канал,
дополнительно шлётся уведомление (см. ``park_offer``/``take_pending_offer``).

Одному человеку сообщения уходят на ВСЕ его подключённые устройства (телефон,
вкладка на компьютере, второе окно): звонок звонит на всех, отвечает то, где
успели нажать «Ответить» (см. ``send_to_other_devices``).
"""

import asyncio
import logging
import time
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)

#: Сколько держим недоставленное сигнальное сообщение (обычно абонент успевает
#: переподключиться за это время: мобильная сеть, перезапуск страницы).
QUEUED_MESSAGE_TTL_SECONDS = 45.0
#: «Звонок закончился» держим дольше: абонент мог заглянуть в приложение позже,
#: и до этого момента он продолжал «звонить» со звуком и окном вызова. Такое
#: сообщение безопасно даже устаревшим: приложение сверяет номер вызова и гасит
#: только свой, ещё не принятый вызов.
CALL_OVER_QUEUE_TTL_SECONDS = 900.0
#: Предел очереди на пользователя: «мёртвый» сокет не должен копить сообщения.
MAX_QUEUED_MESSAGES = 64


class CallConnectionManager:
    """Хранит активные WebSocket-соединения пользователей.

    У одного человека их может быть НЕСКОЛЬКО: телефон, вкладка на компьютере,
    второе окно PWA. Звонок звонит на все его устройства сразу, а отвечает то, где
    успели нажать «Ответить»; остальные получают ``call-ended-elsewhere``.

    Раньше соединение было одно: новое подключение закрывало предыдущее
    (``close(4000, "replaced")``), поэтому звонок приходил только на последнее
    открытое устройство, а на первом пропадал и сигналинг.
    """

    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = {}
        self._lock = asyncio.Lock()
        # Припаркованные входящие вызовы для офлайн-абонентов: user_id -> offer.
        self._pending_offers: dict[int, dict[str, Any]] = {}
        # Недоставленный сигналинг (ответ на звонок, ICE-кандидаты): user_id -> [msg].
        self._queued_messages: dict[int, list[dict[str, Any]]] = {}

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.setdefault(user_id, set()).add(websocket)
        # Только что открыл приложение — есть «висящий» входящий вызов?
        pending = await self.take_pending_offer(user_id)
        if pending is not None:
            await self._send(websocket, pending)
        # …и придержанный сигналинг: порядок сохраняется (offer был отложен раньше
        # ICE-кандидатов, значит и придёт первым).
        for message in await self.take_queued_messages(user_id):
            await self._send(websocket, message)

    def is_online(self, user_id: int) -> bool:
        return bool(self._connections.get(user_id))

    async def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        await self._forget(user_id, [websocket])

    async def send_to_user(self, user_id: int, payload: dict[str, Any]) -> bool:
        """Отправляет сообщение на ВСЕ устройства пользователя.

        Возвращает ``True``, если его приняло хотя бы одно (мёртвые соединения
        попутно выкидываем — иначе они копились бы после сна телефона).
        """
        async with self._lock:
            sockets = list(self._connections.get(user_id, ()))
        return await self._broadcast(user_id, sockets, payload)

    async def send_to_other_devices(
        self,
        user_id: int,
        payload: dict[str, Any],
        *,
        exclude: WebSocket | None,
    ) -> int:
        """Сообщение всем устройствам пользователя, кроме указанного.

        Нужно для «ответили на другом устройстве»: то, где нажали «Ответить»,
        остальным сообщает, что звонить больше не нужно. Возвращает число
        устройств, которые сообщение получили.
        """
        async with self._lock:
            sockets = [
                ws for ws in self._connections.get(user_id, ()) if ws is not exclude
            ]
        if not sockets:
            return 0
        delivered = 0
        stale: list[WebSocket] = []
        for websocket in sockets:
            if await self._send(websocket, payload):
                delivered += 1
            else:
                stale.append(websocket)
        if stale:
            await self._forget(user_id, stale)
        return delivered

    async def _broadcast(
        self, user_id: int, sockets: list[WebSocket], payload: dict[str, Any]
    ) -> bool:
        """Рассылает сообщение по списку соединений и чистит мёртвые."""
        if not sockets:
            return False
        delivered = False
        stale: list[WebSocket] = []
        for websocket in sockets:
            if await self._send(websocket, payload):
                delivered = True
            else:
                stale.append(websocket)
        if stale:
            await self._forget(user_id, stale)
        return delivered

    async def _forget(self, user_id: int, sockets: list[WebSocket]) -> None:
        """Убирает конкретные соединения пользователя (закрылись или не отвечают)."""
        async with self._lock:
            current = self._connections.get(user_id)
            if current is None:
                return
            for websocket in sockets:
                current.discard(websocket)
            if not current:
                self._connections.pop(user_id, None)

    @staticmethod
    async def _send(websocket: WebSocket, payload: dict[str, Any]) -> bool:
        try:
            await websocket.send_json(payload)
            return True
        except Exception:  # noqa: BLE001 - соединение могло разорваться
            logger.warning("Не удалось отправить сообщение через WebSocket")
            return False

    async def park_offer(
        self, callee_id: int, offer: dict[str, Any], ttl_seconds: float = 90.0
    ) -> None:
        """Паркует входящий вызов для офлайн-абонента (до его подключения).

        Срок жизни должен быть БОЛЬШЕ, чем зовущий ждёт ответа
        (``RING_OUT_TIMEOUT_MS`` = 75 с на клиенте): push, холодный старт и вход
        в аккаунт занимают время, и вызов обязан дождаться, пока человек откроет
        приложение. Если парковка истечёт раньше окна зовущего, абонент будет
        отвечать на уже завершённый вызов.
        """
        async with self._lock:
            parked = dict(offer)
            parked["_expires_at"] = time.monotonic() + ttl_seconds
            self._pending_offers[callee_id] = parked

    async def take_pending_offer(self, user_id: int) -> dict[str, Any] | None:
        """Забирает припаркованный offer (если он ещё не истёк)."""
        async with self._lock:
            offer = self._pending_offers.pop(user_id, None)
        if offer is None:
            return None
        if offer.get("_expires_at", 0) < time.monotonic():
            return None
        offer.pop("_expires_at", None)
        return offer

    async def has_pending_offer(self, user_id: int, call_id: str | None = None) -> bool:
        """Есть ли у пользователя ещё «висящий» входящий вызов (не истёк).

        Нужно, чтобы не слать push о звонке, которого уже нет: отменили, или
        абонент сам подключился и забрал offer (``take_pending_offer``).
        """
        async with self._lock:
            offer = self._pending_offers.get(user_id)
        if offer is None:
            return False
        if offer.get("_expires_at", 0) < time.monotonic():
            return False
        if call_id and offer.get("call_id") != call_id:
            return False
        return True

    async def discard_pending_offer(self, callee_id: int, call_id: str | None) -> None:
        """Убирает парковку, если она относится к указанному вызову."""
        if not call_id:
            return
        async with self._lock:
            offer = self._pending_offers.get(callee_id)
            if offer is not None and offer.get("call_id") == call_id:
                self._pending_offers.pop(callee_id, None)

    async def queue_message(
        self,
        user_id: int,
        payload: dict[str, Any],
        ttl_seconds: float | None = None,
    ) -> None:
        """Придерживает сигнальное сообщение до следующего подключения абонента.

        Короткий обрыв сигнального канала (смена сети, перезапуск страницы,
        повторное подключение) не должен «терять» ответ на звонок: иначе у
        зовущего звонок продолжает звонить, хотя собеседник уже нажал «Ответить».

        ``ttl_seconds`` — свой срок жизни для сообщения (см.
        ``CALL_OVER_QUEUE_TTL_SECONDS``).
        """
        ttl = QUEUED_MESSAGE_TTL_SECONDS if ttl_seconds is None else ttl_seconds
        async with self._lock:
            self._prune_queued_locked()
            queue = self._queued_messages.setdefault(user_id, [])
            entry = dict(payload)
            entry["_expires_at"] = time.monotonic() + ttl
            queue.append(entry)
            if len(queue) > MAX_QUEUED_MESSAGES:
                del queue[0 : len(queue) - MAX_QUEUED_MESSAGES]

    async def take_queued_messages(self, user_id: int) -> list[dict[str, Any]]:
        """Отдаёт придержанные сообщения абонента (просроченные выбрасывает)."""
        async with self._lock:
            queue = self._queued_messages.pop(user_id, [])
        now = time.monotonic()
        fresh: list[dict[str, Any]] = []
        for entry in queue:
            if entry.get("_expires_at", 0) < now:
                continue
            entry.pop("_expires_at", None)
            fresh.append(entry)
        return fresh

    def _prune_queued_locked(self) -> None:
        """Чистит истёкшие очереди (иначе они копились бы для «молчащих» абонентов)."""
        now = time.monotonic()
        for user_id in list(self._queued_messages):
            alive = [
                entry
                for entry in self._queued_messages[user_id]
                if entry.get("_expires_at", 0) >= now
            ]
            if alive:
                self._queued_messages[user_id] = alive
            else:
                del self._queued_messages[user_id]


call_manager = CallConnectionManager()
