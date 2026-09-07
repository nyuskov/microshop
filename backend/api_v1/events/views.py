"""WebSocket-эндпоинт событийного канала мессенджера.

Клиент подключается к ``/api/v1/ws/events?token=<jwt>``. Сервер присылает
события:

* ``message.new``  — новое сообщение в чате;
* ``message.changed`` — изменилось сообщение (kind: pin/reaction/deleted/...);
* ``chat.new`` — с пользователем начат новый чат;
* ``chat.read`` — собеседник прочитал сообщения чата;
* ``presence`` — пользователь стал «в сети» / «не в сети».

Соединение также считается признаком присутствия: при подключении участникам
общих чатов уходит ``presence online``, при отключении — ``presence offline``
с обновлённым ``last_seen``.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from api_v1.auth.utils import resolve_user_from_websocket, touch_last_seen
from api_v1.users.crud import get_user_by_id
from core.models import db_helper

from .manager import events_manager
from .service import presence_peer_ids

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["Realtime"])


async def _broadcast_presence(
    peer_ids: list[int],
    user_id: int,
    *,
    online: bool,
    last_seen: datetime | None,
) -> None:
    """Сообщает участникам общих чатов об изменении присутствия пользователя."""
    payload = {
        "type": "presence",
        "user_id": user_id,
        "online": online,
        "last_seen": last_seen.isoformat() if last_seen is not None else None,
    }
    await events_manager.broadcast(peer_ids, payload)


@router.websocket("/events")
async def websocket_events(websocket: WebSocket) -> None:
    """Событийный канал мессенджера для текущего авторизованного пользователя."""
    user = await resolve_user_from_websocket(websocket)
    if user is None:
        return

    await events_manager.connect(user.id, websocket)

    # Подключение = признак присутствия: обновляем last_seen и сообщаем
    # участникам общих чатов, что пользователь «в сети».
    peers: list[int] = []
    current_last_seen: datetime | None = None
    async with db_helper.session_factory() as session:
        current = await get_user_by_id(session, user.id)
        if current is not None:
            await touch_last_seen(current, session)
            current_last_seen = current.last_seen
            peers = await presence_peer_ids(session, user.id)
    await _broadcast_presence(peers, user.id, online=True, last_seen=current_last_seen)

    try:
        # Сервер только пушит события — сообщения клиента не используются.
        while True:
            await websocket.receive_json()
    except WebSocketDisconnect:
        logger.debug("Пользователь %s отключился от событийного канала", user.id)
    finally:
        await events_manager.disconnect(user.id, websocket)
        # «Не в сети» — только если это было последнее соединение пользователя
        # (иначе новое соединение/другая вкладка уже сообщили «в сети»).
        if events_manager.is_online(user.id):
            return

        try:
            offline_last_seen: datetime | None = None
            async with db_helper.session_factory() as session:
                current = await get_user_by_id(session, user.id)
                if current is not None:
                    current.last_seen = datetime.now(timezone.utc)
                    await session.commit()
                    offline_last_seen = current.last_seen
                    peers = await presence_peer_ids(session, user.id)
            await _broadcast_presence(
                peers, user.id, online=False, last_seen=offline_last_seen
            )
        except Exception:  # noqa: BLE001 - офлайн-статус некритичен
            logger.exception("Не удалось отправить presence offline для %s", user.id)
