"""Менеджер WebSocket-подключений для сигналинга звонков.

Сервер выступает лишь ретранслятором сообщений WebRTC (SDP offer/answer,
ICE-candidates, отмена/сброс/завершение) между двумя участниками вызова.

Если вызываемый абонент офлайн (приложение закрыто), offer «паркуется»: когда он
подключится, offer доставится и звонок его дождётся. Если у абонента есть push-канал,
дополнительно шлётся уведомление (см. ``park_offer``/``take_pending_offer``).
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
#: Предел очереди на пользователя: «мёртвый» сокет не должен копить сообщения.
MAX_QUEUED_MESSAGES = 64


class CallConnectionManager:
    """Хранит активные WebSocket-соединения пользователей.

    У каждого пользователя может быть только одно активное соединение —
    новое подключение заменяет предыдущее (актуально после перезагрузки вкладки).
    """

    def __init__(self) -> None:
        self._connections: dict[int, WebSocket] = {}
        self._lock = asyncio.Lock()
        # Припаркованные входящие вызовы для офлайн-абонентов: user_id -> offer.
        self._pending_offers: dict[int, dict[str, Any]] = {}
        # Недоставленный сигналинг (ответ на звонок, ICE-кандидаты): user_id -> [msg].
        self._queued_messages: dict[int, list[dict[str, Any]]] = {}

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            previous = self._connections.get(user_id)
            self._connections[user_id] = websocket
        if previous is not None and previous is not websocket:
            try:
                await previous.close(code=4000, reason="replaced")
            except Exception:  # noqa: BLE001 - могло уже закрыться
                logger.debug(
                    "Предыдущее соединение пользователя %s уже закрыто", user_id
                )
        # Только что открыл приложение — есть «висящий» входящий вызов?
        pending = await self.take_pending_offer(user_id)
        if pending is not None:
            await self._send(websocket, pending)
        # …и придержанный сигналинг: порядок сохраняется (offer был отложен раньше
        # ICE-кандидатов, значит и придёт первым).
        for message in await self.take_queued_messages(user_id):
            await self._send(websocket, message)

    def is_online(self, user_id: int) -> bool:
        return user_id in self._connections

    async def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            if self._connections.get(user_id) is websocket:
                self._connections.pop(user_id, None)

    async def send_to_user(self, user_id: int, payload: dict[str, Any]) -> bool:
        """Отправляет сообщение пользователю, если он подключён.

        Возвращает ``True``, если сообщение доставлено.
        """
        async with self._lock:
            websocket = self._connections.get(user_id)
        if websocket is None:
            return False
        return await self._send(websocket, payload)

    @staticmethod
    async def _send(websocket: WebSocket, payload: dict[str, Any]) -> bool:
        try:
            await websocket.send_json(payload)
            return True
        except Exception:  # noqa: BLE001 - соединение могло разорваться
            logger.warning("Не удалось отправить сообщение через WebSocket")
            return False

    async def park_offer(
        self, callee_id: int, offer: dict[str, Any], ttl_seconds: float = 75.0
    ) -> None:
        """Паркует входящий вызов для офлайн-абонента (до его подключения).

        Срок жизни должен быть не меньше, чем зовущий ждёт ответа
        (``RING_OUT_TIMEOUT_MS`` = 60 с на клиенте): push, холодный старт и вход
        в аккаунт занимают время, и вызов обязан дождаться, пока человек откроет
        приложение.
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

    async def queue_message(self, user_id: int, payload: dict[str, Any]) -> None:
        """Придерживает сигнальное сообщение до следующего подключения абонента.

        Короткий обрыв сигнального канала (смена сети, перезапуск страницы,
        повторное подключение) не должен «терять» ответ на звонок: иначе у
        зовущего звонок продолжает звонить, хотя собеседник уже нажал «Ответить».
        """
        async with self._lock:
            self._prune_queued_locked()
            queue = self._queued_messages.setdefault(user_id, [])
            entry = dict(payload)
            entry["_expires_at"] = time.monotonic() + QUEUED_MESSAGE_TTL_SECONDS
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
