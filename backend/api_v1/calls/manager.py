"""Менеджер WebSocket-подключений для сигналинга звонков.

Сервер выступает лишь ретранслятором сообщений WebRTC (SDP offer/answer,
ICE-candidates, отмена/сброс/завершение) между двумя участниками вызова.

Если вызываемый абонент офлайн (приложение закрыто), offer «паркуется» и ему
шлётся Web Push — когда он откроет приложение и подключится, offer доставится
(см. ``park_offer``/``take_pending_offer``).
"""

import asyncio
import logging
import time
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


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
        self, callee_id: int, offer: dict[str, Any], ttl_seconds: float = 55.0
    ) -> None:
        """Паркует входящий вызов для офлайн-абонента (до его подключения)."""
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

    async def discard_pending_offer(self, callee_id: int, call_id: str | None) -> None:
        """Убирает парковку, если она относится к указанному вызову."""
        if not call_id:
            return
        async with self._lock:
            offer = self._pending_offers.get(callee_id)
            if offer is not None and offer.get("call_id") == call_id:
                self._pending_offers.pop(callee_id, None)


call_manager = CallConnectionManager()
