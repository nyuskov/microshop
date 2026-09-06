"""WebSocket-эндпоинт сигналинга звонков (WebRTC).

Клиент подключается к ``/api/v1/ws/calls?token=<jwt>`` и обменивается JSON:
``call-offer``, ``call-answer``, ``ice-candidate``, ``call-cancel``,
``call-decline``, ``call-end``. Сервер только пересылает сообщения адресату.

Если получатель offer офлайн, инициатору уходит ``call-unavailable``.
"""

import logging
from typing import Any

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.models import db_helper
from core.models.user import User

from ..auth.utils import decode_jwt
from ..users.crud import get_user_by_id
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


async def _resolve_user_or_close(websocket: WebSocket) -> User | None:
    """Проверяет JWT из query-параметра и возвращает пользователя.

    При ошибке закрывает соединение кодом 4401 и возвращает ``None``.
    """
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4401)
        return None
    try:
        payload = decode_jwt(token)
    except jwt.InvalidTokenError:
        await websocket.close(code=4401)
        return None

    sub_value = str(payload.get("sub", ""))
    if not sub_value.isdigit():
        await websocket.close(code=4401)
        return None

    async with db_helper.session_factory() as session:
        user = await get_user_by_id(session, int(sub_value))
    if user is None:
        await websocket.close(code=4401)
        return None
    return user


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
    user = await _resolve_user_or_close(websocket)
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
