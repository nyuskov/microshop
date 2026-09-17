"""Менеджер WebSocket-подключений событийного канала мессенджера.

В отличие от сигналинга звонков здесь поддерживается несколько соединений
на пользователя (несколько вкладок): событие доставляется во все активные.

Отдельно различаем «канал открыт» и «человек у экрана»: свёрнутое/свёрнутое в
фон приложение соединение не рвёт (сообщения должны доходить), но человеком оно
не считается — собеседник не должен видеть «в сети» у того, кто ушёл в другое
приложение.
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
        #: Соединения, владелец которых сейчас смотрит в приложение (не свёрнуто).
        self._active: dict[int, set[WebSocket]] = {}
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
            active = self._active.get(user_id)
            if active is not None:
                active.discard(websocket)
                if not active:
                    self._active.pop(user_id, None)

    def is_online(self, user_id: int) -> bool:
        """Есть ли вообще открытый канал (даже если приложение свёрнуто)."""
        return user_id in self._connections

    def is_present(self, user_id: int) -> bool:
        """Смотрит ли человек в приложение прямо сейчас."""
        return bool(self._active.get(user_id))

    async def set_active(
        self, user_id: int, websocket: WebSocket, active: bool
    ) -> bool:
        """Помечает соединение «человек у экрана»/«свёрнуто».

        Возвращает ``True``, если присутствие пользователя от этого изменилось
        (только тогда надо рассылать `presence`): поставили «свёрнуто», а других
        активных соединений нет — или наоборот.
        """
        async with self._lock:
            was = bool(self._active.get(user_id))
            sockets = self._active.setdefault(user_id, set())
            if active:
                sockets.add(websocket)
            else:
                sockets.discard(websocket)
            if not sockets:
                self._active.pop(user_id, None)
            now = bool(self._active.get(user_id))
        return was != now

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

    async def broadcast(self, user_ids: list[int], payload: dict[str, Any]) -> bool:
        """Отправляет событие списку пользователей (без дублей по id).

        Возвращает ``True``, если доставлено хотя бы одному: по этому признаку
        решается, публиковать ли событие в мост для других процессов web (см.
        `api_v1/events/service.dispatch_realtime`).
        """
        delivered = False
        for user_id in dict.fromkeys(user_ids):
            if await self.send_to_user(user_id, payload):
                delivered = True
        return delivered


events_manager = EventsConnectionManager()
