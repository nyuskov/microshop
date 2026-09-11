"""WebSocket-эндпоинт сигналинга звонков (WebRTC).

Клиент подключается к ``/api/v1/ws/calls?token=<jwt>`` и обменивается JSON:
``call-offer``, ``call-answer``, ``ice-candidate``, ``call-cancel``,
``call-decline``, ``call-end``, ``call-renegotiate``, ``call-renegotiate-answer``,
``call-screen``. Сервер пересылает сообщения адресату.

Если получатель offer офлайн (приложение закрыто), но у него есть push-канал
(Web Push для PWA или RuStore Push для Android-приложения) — вызов «паркуется»,
а абоненту шлётся уведомление «Вам звонят…»; когда он откроет приложение и
подключится, offer доставится. Если push-каналов нет — инициатору сразу уходит
``call-unavailable``.
"""

import asyncio
import logging
from collections.abc import Coroutine
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from api_v1.chats.crud import get_private_chat_id_between
from api_v1.events.service import notify_chat
from api_v1.push import crud as push_crud
from core import rustore_push
from core.config import settings
from core.models import Message, User, db_helper

from ..auth.utils import get_current_user, resolve_user_from_websocket
from .manager import call_manager
from .turn import ice_servers, turn_configured

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["Calls"])
# REST-роутер звонков (для push-кнопки «Отклонить» из service worker).
router_rest = APIRouter(prefix="/calls", tags=["Calls"])


def _any_push_channel_configured() -> bool:
    """Настроен ли хотя бы один канал уведомлений (Web Push или RuStore Push)."""
    web_push = bool(
        settings.web_push_vapid_public_key and settings.web_push_vapid_private_key
    )
    return web_push or rustore_push.is_configured()


class CallDeclineRequest(BaseModel):
    """Отказ по входящему звонку из уведомления (service worker)."""

    call_id: str
    to_user_id: int


@router_rest.post("/decline/")
async def decline_call(
    payload: CallDeclineRequest,
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    """Отклоняет входящий звонок, не открывая приложение."""
    # Снимаем припаркованный offer получателя, если он ещё «висит».
    await call_manager.discard_pending_offer(user.id, payload.call_id)
    delivered = await call_manager.send_to_user(
        payload.to_user_id,
        {
            "type": "call-decline",
            "call_id": payload.call_id,
            "to_user_id": payload.to_user_id,
            "from_user_id": user.id,
            "reason": "declined",
        },
    )
    return {"ok": delivered}


#: Типы сообщений, которые сервер пересылает адресату без изменений.
RELAY_MESSAGE_TYPES = frozenset(
    {
        "call-offer",
        "call-answer",
        "ice-candidate",
        "call-cancel",
        "call-decline",
        "call-end",
        # Пересогласование SDP посреди звонка: добавление/замена видео-дорожки
        # (демонстрация экрана, смена камеры). Сервер только пересылает SDP.
        "call-renegotiate",
        "call-renegotiate-answer",
        # Статус демонстрации экрана — для индикатора у собеседника.
        "call-screen",
        # Возврат собеседника в идущий звонок после перезагрузки страницы: у него
        # новое соединение и новые ICE-адреса, поэтому вторая сторона
        # пересогласовывает SDP (иначе звонок выглядел бы сброшенным).
        "call-rejoin",
    }
)

# ---------- История звонков (системные сообщения в чат) ----------
# Сервер видит сигналинг и фиксирует исход звонка: completed/missed/declined.
_CALL_TRACK_TYPES = frozenset(
    {"call-offer", "call-answer", "call-cancel", "call-decline", "call-end"}
)
_active_calls: dict[str, dict[str, Any]] = {}


async def _track_call_event(
    message_type: str,
    from_user_id: int,
    to_user_id: int,
    data: dict[str, Any],
) -> None:
    call_id = data.get("call_id")
    if not call_id:
        return
    if message_type == "call-offer":
        _active_calls[call_id] = {
            "caller": from_user_id,
            "callee": to_user_id,
            "kind": data.get("kind"),
            "started": None,
        }
        return
    meta = _active_calls.get(call_id)
    if meta is None:
        return
    if message_type == "call-answer":
        meta["started"] = datetime.now(timezone.utc)
        return
    # Завершение/отмена/отказ.
    _active_calls.pop(call_id, None)
    if message_type == "call-end" and meta.get("started") is not None:
        started = meta["started"]
        duration = max(0, int((datetime.now(timezone.utc) - started).total_seconds()))
        await _persist_call_record(meta, "completed", duration)
    elif message_type == "call-decline":
        await _persist_call_record(meta, "declined", 0)
    elif message_type == "call-cancel":
        await _persist_call_record(meta, "missed", 0)


async def _persist_call_record(meta: dict[str, Any], state: str, duration: int) -> None:
    """Пишет системное сообщение о звонке в личный чат участников."""
    caller = meta.get("caller")
    callee = meta.get("callee")
    if not caller or not callee:
        return
    try:
        async with db_helper.session_factory() as session:
            chat_id = await get_private_chat_id_between(session, caller, callee)
            if chat_id is None:
                return
            message = Message(
                text="",
                chat_id=chat_id,
                user_id=caller,
                kind="call",
                call_kind=meta.get("kind") or "audio",
                call_state=state,
                call_duration=duration,
                call_caller_id=caller,
            )
            session.add(message)
            await session.commit()
            await notify_chat(
                session,
                chat_id=chat_id,
                payload={
                    "type": "message.new",
                    "chat_id": chat_id,
                    "message_id": message.id,
                    "sender_id": caller,
                },
                exclude_user_id=None,
                # Запись о звонке — не новое сообщение: push «Новое сообщение»
                # после разговора не нужен, человек о звонке уже знает.
                push=False,
            )
    except Exception:  # noqa: BLE001 - история звонка не роняет сигналинг
        logger.exception("Не удалось записать отметку о звонке")


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

    if message_type in _CALL_TRACK_TYPES:
        await _track_call_event(message_type, from_user_id, to_user_id, data)

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


#: Пауза перед push о входящем звонке.
#:
#: За это время зовущий может отменить вызов, а абонент — сам открыть приложение
#: и забрать припаркованный offer. Тогда уведомление «Вам звонят» не отправляем:
#: иначе человек получал бы его, когда звонка уже нет (отменён или уже отвечен).
CALL_PUSH_DELAY_SECONDS = 2.0
#: Сколько push о звонке остаётся актуальным (зовущий «звонит» ~30 с).
CALL_PUSH_VALID_SECONDS = 30.0

#: Фоновые задачи веб-процесса: держим ссылки, иначе сборщик мусора их съест.
_background_tasks: set[asyncio.Task[None]] = set()


def _spawn(coro: Coroutine[Any, Any, None]) -> None:
    """Запускает фоновую задачу, не блокируя обработку сигналинга."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def _call_push_expires_at() -> int:
    """Момент (мс UTC), после которого push о звонке показывать бессмысленно."""
    seconds = datetime.now(timezone.utc).timestamp() + CALL_PUSH_VALID_SECONDS
    return int(seconds * 1000)


async def _enqueue_call_push_when_ringing(
    *, callee_id: int, caller_id: int, offer: dict[str, Any]
) -> None:
    """Ставит push о входящем звонке — только если вызов ещё «висит».

    Проверку делаем с задержкой (``CALL_PUSH_DELAY_SECONDS``) и в том же процессе,
    который держит парковку: отменил зовущий или абонент уже подключился —
    уведомление не нужно, он и так знает о звонке.
    """
    call_id = offer.get("call_id")
    try:
        await asyncio.sleep(CALL_PUSH_DELAY_SECONDS)
        if not await call_manager.has_pending_offer(callee_id, call_id):
            logger.info("Звонок %s уже снят — push не отправляем", call_id)
            return
        from core.celery_app import get_task

        get_task("tasks.notifications.send_call_push").delay(
            callee_id,
            call_id,
            caller_id,
            offer.get("kind"),
            _call_push_expires_at(),
        )
    except Exception:  # noqa: BLE001 - push не должен ронять сигналинг
        logger.exception("Не удалось поставить задачу push о входящем звонке")


async def _park_offer_and_push(
    *, callee_id: int, caller_id: int, offer: dict[str, Any]
) -> bool:
    """Паркует входящий вызов для офлайн-абонента и шлёт push.

    Возвращает ``True``, если вызов «принят в обработку»: у абонента есть хотя бы
    один push-канал — Web Push (PWA) или RuStore Push (Android-приложение).
    """
    if not _any_push_channel_configured():
        return False

    async with db_helper.session_factory() as session:
        subscriptions = await push_crud.get_subscriptions_for_users(
            session, [callee_id]
        )
        rustore_tokens = await push_crud.get_rustore_tokens_for_users(
            session, [callee_id]
        )
    if not subscriptions and not rustore_tokens:
        return False

    await call_manager.park_offer(callee_id, offer)
    # Собеседник не в сети: он получит push и сможет ответить, если откроет
    # приложение. Зовущему говорим об этом, чтобы он понимал, что происходит.
    await call_manager.send_to_user(
        caller_id,
        {
            "type": "call-parked",
            "call_id": offer.get("call_id"),
            "to_user_id": callee_id,
        },
    )
    _spawn(
        _enqueue_call_push_when_ringing(
            callee_id=callee_id, caller_id=caller_id, offer=offer
        )
    )
    return True


async def _handle_message(from_user_id: int, data: Any) -> None:
    if not isinstance(data, dict):
        return
    if data.get("type") not in RELAY_MESSAGE_TYPES:
        return
    await _relay_message(from_user_id, data)


class IceServersResponse(BaseModel):
    """ICE-серверы для звонка (STUN всегда, TURN — с временными кредами)."""

    ice_servers: list[dict[str, Any]]
    #: Срок жизни выданных TURN-кредов в секундах (0 — TURN не настроен).
    ttl: int


@router_rest.get("/ice-servers/", response_model=IceServersResponse)
async def get_ice_servers(
    user: User = Depends(get_current_user),
) -> IceServersResponse:
    """Отдаёт клиенту список ICE-серверов со свежими TURN-кредами.

    Креды считаются на лету по общему секрету (см. ``turn.py``), поэтому в
    клиентском бандле нет ни пароля, ни возможности вытащить его и пользоваться
    релеем от нашего имени.
    """
    servers = ice_servers(user.id)
    return IceServersResponse(
        ice_servers=servers,
        ttl=int(settings.turn_ttl_seconds) if turn_configured() else 0,
    )


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
