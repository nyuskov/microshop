"""Менеджер WebSocket-подключений для сигналинга звонков.

Сервер выступает лишь ретранслятором сообщений WebRTC (SDP offer/answer,
ICE-candidates, отмена/сброс/завершение) между двумя участниками вызова.
"""

import asyncio
import logging
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
        try:
            await websocket.send_json(payload)
            return True
        except Exception:  # noqa: BLE001 - соединение могло разорваться
            logger.warning("Не удалось доставить сообщение пользователю %s", user_id)
            return False


call_manager = CallConnectionManager()
