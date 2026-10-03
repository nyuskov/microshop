"""Менеджер WebSocket-подключений событийного канала мессенджера.

В отличие от сигналинга звонков здесь поддерживается несколько соединений
на пользователя (несколько вкладок): событие доставляется во все активные.

Отдельно различаем «канал открыт» и «человек у экрана»: свёрнутое/свёрнутое в
фон приложение соединение не рвёт (сообщения должны доходить), но человеком оно
не считается — собеседник не должен видеть «в сети» у того, кто ушёл в другое
приложение.

Сокеты живут только в этом процессе, поэтому присутствие собирается из двух
источников: свои активные соединения и «пульс» других процессов web (см.
``mark_remote_present`` и ``presence_heartbeat`` в `api_v1/events/bridge.py`).
Без второго при двух слотах `presence_snapshot` врал бы: человек на другом слоте
выглядел бы ушедшим.
"""

import asyncio
import logging
import time
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)

#: Сколько считаем «пульс» другого процесса живым. Больше интервала пульса с
#: запасом: процесс может задуматься на сборке мусора или на секунду потерять
#: брокер, и «в сети» не должно мигать от этого.
PRESENCE_TTL_SECONDS = 45.0


class EventsConnectionManager:
    """Хранит активные WebSocket-соединения пользователей."""

    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = {}
        #: Соединения, владелец которых сейчас смотрит в приложение (не свёрнуто).
        self._active: dict[int, set[WebSocket]] = {}
        self._lock = asyncio.Lock()
        #: Пользователи, про которых мы узнали из пульса других процессов:
        #: user_id -> момент (monotonic), до которого считаем их «у экрана».
        self._remote_present: dict[int, float] = {}

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

    def connection_stats(self) -> tuple[int, int]:
        """Сколько людей на связи и сколько всего сокетов (для метрик).

        Читаем БЕЗ блокировки: число нужно только для оценки нагрузки, а
        точность до одного соединения роли не играет — блокировка здесь
        задерживала бы подключения ради красивой цифры.
        """
        return len(self._connections), sum(
            len(sockets) for sockets in self._connections.values()
        )

    def is_present(self, user_id: int) -> bool:
        """Смотрит ли человек в приложение прямо сейчас.

        Учитываем и свои сокеты, и пульс других процессов: человек может быть у
        экрана на другом слоте `web`, и тогда «не в сети» у собеседника было бы
        ошибкой.
        """
        if self._active.get(user_id):
            return True
        return self._remote_present.get(user_id, 0.0) > time.monotonic()

    def local_present_ids(self) -> list[int]:
        """Кто у экрана в ЭТОМ процессе (для пульса другим)."""
        return [user_id for user_id, sockets in self._active.items() if sockets]

    def mark_remote_present(self, user_ids: list[int]) -> None:
        """Отмечает пришедший пульс другого процесса (живёт до TTL).

        Заодно чистим протухшие записи: без этого карта копила бы всех, кто
        когда-либо был в сети на другом слоте.
        """
        expires_at = time.monotonic() + PRESENCE_TTL_SECONDS
        for user_id in user_ids:
            self._remote_present[user_id] = expires_at
        stale = [
            user_id
            for user_id, until in self._remote_present.items()
            if until <= time.monotonic()
        ]
        for user_id in stale:
            self._remote_present.pop(user_id, None)

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
            except Exception:  # соединение могло разорваться
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
