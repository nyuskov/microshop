"""Менеджер WebSocket-подключений событийного канала мессенджера.

В отличие от сигналинга звонков здесь поддерживается несколько соединений
на пользователя (несколько вкладок): событие доставляется во все активные.
"""

import asyncio
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class EventsConnectionManager:
    """Хранит активные WebSocket-соединения пользователей."""

    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.setdefault(user_id, set()).add(websocket)

    async def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            sockets = self._connections.get(user_id)
            if sockets is None:
                return
            sockets.discard(websocket)
            if not sockets:
                self._connections.pop(user_id, None)

    def is_online(self, user_id: int) -> bool:
        """Есть ли у пользователя хотя бы одно активное соединение."""
        return user_id in self._connections

    async def send_to_user(self, user_id: int, payload: dict[str, Any]) -> bool:
        """Отправляет событие во все соединения пользователя.

        Возвращает ``True``, если удалось доставить хотя бы в одно.
        """
        async with self._lock:
            sockets = list(self._connections.get(user_id, ()))
        if not sockets:
            return False
        delivered = False
        for websocket in sockets:
            try:
                await websocket.send_json(payload)
                delivered = True
            except Exception:  # noqa: BLE001 - соединение могло разорваться
                logger.debug("Не удалось доставить событие пользователю %s", user_id)
        return delivered

    async def broadcast(self, user_ids: list[int], payload: dict[str, Any]) -> None:
        """Отправляет событие списку пользователей (без дублей по id)."""
        for user_id in dict.fromkeys(user_ids):
            await self.send_to_user(user_id, payload)


events_manager = EventsConnectionManager()
