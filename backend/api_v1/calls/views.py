"""WebSocket-эндпоинт сигналинга звонков (WebRTC).

Клиент подключается к ``/api/v1/ws/calls?token=<jwt>`` и обменивается JSON:
``call-offer``, ``call-answer``, ``ice-candidate``, ``call-cancel``,
``call-decline``, ``call-end``. Сервер только пересылает сообщения адресату.

Если получатель offer офлайн, инициатору уходит ``call-unavailable``.
"""

import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..auth.utils import resolve_user_from_websocket
from .manager import call_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["Calls"])

#: Типы сообщений, которые сервер пересылает адресату без изменений.
RELAY_MESSAGE_TYPES = frozenset(
    {
        "call-offer",
        "call-answer",
        "ice-candidate",
        "call-cancel",
        "call-decline",
        "call-end",
    }
)


async def _relay_message(from_user_id: int, data: dict[str, Any]) -> None:
    """Пересылает сообщение сигналинга от одного участника другому."""
    raw_target = data.get("to_user_id")
    try:
        to_user_id = int(raw_target)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return

    envelope = dict(data)
    envelope["from_user_id"] = from_user_id

    delivered = await call_manager.send_to_user(to_user_id, envelope)
    if not delivered and data.get("type") == "call-offer":
        # Абонент офлайн — сообщаем инициатору.
        await call_manager.send_to_user(
            from_user_id,
            {
                "type": "call-unavailable",
                "call_id": data.get("call_id"),
                "to_user_id": to_user_id,
                "from_user_id": to_user_id,
            },
        )


async def _handle_message(from_user_id: int, data: Any) -> None:
    if not isinstance(data, dict):
        return
    if data.get("type") not in RELAY_MESSAGE_TYPES:
        return
    await _relay_message(from_user_id, data)


@router.websocket("/calls")
async def websocket_calls(websocket: WebSocket) -> None:
    """Сигнальный канал звонков для текущего авторизованного пользователя."""
    user = await resolve_user_from_websocket(websocket)
    if user is None:
        return

    await call_manager.connect(user.id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            await _handle_message(user.id, data)
    except WebSocketDisconnect:
        logger.debug("Пользователь %s отключился от сигналинга", user.id)
    finally:
        await call_manager.disconnect(user.id, websocket)
