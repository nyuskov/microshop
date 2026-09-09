"""WebSocket-эндпоинт сигналинга звонков (WebRTC).

Клиент подключается к ``/api/v1/ws/calls?token=<jwt>`` и обменивается JSON:
``call-offer``, ``call-answer``, ``ice-candidate``, ``call-cancel``,
``call-decline``, ``call-end``. Сервер пересылает сообщения адресату.

Если получатель offer офлайн (приложение закрыто), но у него есть push-
подписки — вызов «паркуется», а абоненту шлётся Web Push «Вам звонят…»;
когда он откроет приложение и подключится, offer доставится. Если push-
подписок нет — инициатору сразу уходит ``call-unavailable``.
"""

import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from api_v1.push import crud as push_crud
from core.config import settings
from core.models import db_helper

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
    message_type = data.get("type")

    delivered = await call_manager.send_to_user(to_user_id, envelope)
    if delivered:
        # Доставлено — парковка для этого вызова больше не нужна.
        if message_type in ("call-cancel", "call-decline", "call-end"):
            await call_manager.discard_pending_offer(to_user_id, data.get("call_id"))
        return

    # Абонент офлайн.
    if message_type == "call-offer":
        parked = await _park_offer_and_push(
            callee_id=to_user_id,
            caller_id=from_user_id,
            offer=envelope,
        )
        if not parked:
            # Нет ни подписок, ни соединения — не достучаться.
            await call_manager.send_to_user(
                from_user_id,
                {
                    "type": "call-unavailable",
                    "call_id": data.get("call_id"),
                    "to_user_id": to_user_id,
                    "from_user_id": to_user_id,
                },
            )
    elif message_type in ("call-cancel", "call-decline", "call-end"):
        # Отменяем/снимаем «висящий» вызов у офлайн-абонента.
        await call_manager.discard_pending_offer(to_user_id, data.get("call_id"))


async def _park_offer_and_push(
    *, callee_id: int, caller_id: int, offer: dict[str, Any]
) -> bool:
    """Паркует входящий вызов для офлайн-абонента и шлёт ему Web Push.

    Возвращает ``True``, если вызов «принят в обработку» (есть push-подписки).
    """
    if (
        not settings.web_push_vapid_public_key
        or not settings.web_push_vapid_private_key
    ):
        return False

    async with db_helper.session_factory() as session:
        subscriptions = await push_crud.get_subscriptions_for_users(
            session, [callee_id]
        )
    if not subscriptions:
        return False

    await call_manager.park_offer(callee_id, offer)
    try:
        from core.celery_app import get_task

        get_task("tasks.notifications.send_call_push").delay(
            callee_id,
            offer.get("call_id"),
            caller_id,
            offer.get("kind"),
        )
    except Exception:  # noqa: BLE001 - push не должен ронять сигналинг
        logger.exception("Не удалось поставить задачу push о входящем звонке")
    return True


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
