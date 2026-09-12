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

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from api_v1.auth.utils import resolve_user_from_websocket, touch_last_seen
from api_v1.users.crud import get_user_by_id
from core.models import db_helper

from .manager import events_manager
from .service import chat_member_ids, presence_peer_ids

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["Realtime"])

#: Сколько ждём от клиента хоть какой-нибудь активности, прежде чем считать канал
#: мёртвым. Браузер шлёт ``ping`` раз в 25 секунд (см. `stores/realtime.ts`), но в
#: фоновой вкладке таймеры Chrome троттлятся до раза в минуту — поэтому запас.
#:
#: Без этого «человек вышел, а он ещё в сети»: если приложение убили или телефон
#: уснул, сокет не закрывается чисто и сервер узнаёт об уходе только по таймауту
#: прокси — а это минуты, и всё это время собеседник видит «в сети».
WS_IDLE_TIMEOUT_SECONDS = 90
#: Сколько ждём `activity` от нового соединения, прежде чем считать, что клиент
#: старый и не умеет сообщать о свёрнутом окне (тогда — как раньше, «в сети»).
WS_ACTIVITY_FALLBACK_SECONDS = 2.0
#: Как часто обновлять ``last_seen`` по heartbeat (реже самого ping — в БД
#: писать каждые 25 секунд незачем).
WS_LAST_SEEN_TOUCH_SECONDS = 60


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


async def _handle_client_event(user_id: int, data: Any) -> None:
    """Обрабатывает события от клиента (сейчас — индикатор «печатает…»).

    ``typing``/``typing-stop`` ретранслируются участникам чата, кроме автора.
    """
    if not isinstance(data, dict):
        return
    event_type = data.get("type")
    if event_type not in ("typing", "typing-stop"):
        return
    try:
        chat_id = int(data["chat_id"])  # type: ignore[arg-type]
    except (KeyError, TypeError, ValueError):
        return

    async with db_helper.session_factory() as session:
        members = await chat_member_ids(session, chat_id)
    if user_id not in members:
        return
    recipients = [member_id for member_id in members if member_id != user_id]
    await events_manager.broadcast(
        recipients,
        {"type": event_type, "chat_id": chat_id, "user_id": user_id},
    )


async def _presence_last_seen(user_id: int) -> tuple[datetime | None, list[int]]:
    """Время ухода и участники общих чатов (для рассылки `presence`)."""
    async with db_helper.session_factory() as session:
        current = await get_user_by_id(session, user_id)
        if current is None:
            return None, []
        current.last_seen = datetime.now(timezone.utc)
        await session.commit()
        peers = await presence_peer_ids(session, user_id)
        return current.last_seen, peers


async def _report_presence(user_id: int, *, online: bool) -> None:
    """Сообщает участникам общих чатов, что человек у экрана/ушёл.

    «Ушёл» всегда с обновлённым `last_seen`: собеседник видит «был(а) только что»,
    а не старое время (например, когда приложение было свёрнуто).
    """
    try:
        last_seen, peers = await _presence_last_seen(user_id)
        await _broadcast_presence(peers, user_id, online=online, last_seen=last_seen)
    except Exception:  # noqa: BLE001 - статус присутствия некритичен
        logger.exception("Не удалось отправить presence для %s", user_id)


@router.websocket("/events")
async def websocket_events(websocket: WebSocket) -> None:
    """Событийный канал мессенджера для текущего авторизованного пользователя."""
    user = await resolve_user_from_websocket(websocket)
    if user is None:
        return

    await events_manager.connect(user.id, websocket)

    # Подключение НЕ значит «в сети»: приложение могло переподключиться в фоне
    # (свёрнутое/закрытое). Клиент сразу присылает `activity`, и только тогда
    # рассылаем статус. Для старых клиентов, которые такого сообщения не шлют,
    # есть короткая страховка — иначе человек никогда не показывался бы «в сети».
    last_seen_confirmed = False

    async def auto_present() -> None:
        await asyncio.sleep(WS_ACTIVITY_FALLBACK_SECONDS)
        if last_seen_confirmed:
            return
        # Клиент не прислал `activity` — старая сборка. Считаем «в сети», как
        # раньше, но пишем это в лог: по нему видно, у кого именно статус может
        # «переключаться» (старый клиент сообщает о себе одним фактом соединения,
        # поэтому каждый переподключённый сокет в фоне выглядит как «в сети»).
        logger.info(
            "Пользователь %s: клиент без `activity` — считаем «в сети» "
            "(старая версия клиента?)",
            user.id,
        )
        if await events_manager.set_active(user.id, websocket, True):
            await _report_presence(user.id, online=True)

    fallback_task = asyncio.create_task(auto_present())

    try:
        # Сервер в основном пушит события; от клиента принимаем typing/typing-stop,
        # а также heartbeat (`ping`), активность (`activity`) и прощание (`bye`).
        last_touch = 0.0
        while True:
            try:
                data = await asyncio.wait_for(
                    websocket.receive_json(), timeout=WS_IDLE_TIMEOUT_SECONDS
                )
            except asyncio.TimeoutError:
                # Канал молчит: приложение закрыли/убили, сеть пропала или телефон
                # уснул. Закрываем — дальше сработает блок «не в сети».
                logger.info("Событийный канал %s молчит — закрываем", user.id)
                await websocket.close(code=1000)
                break
            if isinstance(data, dict) and data.get("type") == "activity":
                # Свёрнутое приложение — это «не в сети»: человек в другом окне.
                active = data.get("active") is not False
                last_seen_confirmed = True
                if await events_manager.set_active(user.id, websocket, active):
                    await _report_presence(user.id, online=active)
                continue
            if isinstance(data, dict) and data.get("type") in ("ping", "pong"):
                # Заодно освежаем время последней активности (собеседники видят
                # его по `last_seen`, когда пользователь не в сети).
                now = time.monotonic()
                if now - last_touch >= WS_LAST_SEEN_TOUCH_SECONDS:
                    last_touch = now
                    async with db_helper.session_factory() as session:
                        current = await get_user_by_id(session, user.id)
                        if current is not None:
                            await touch_last_seen(current, session)
                continue
            if isinstance(data, dict) and data.get("type") == "bye":
                # Человек уходит со страницы: не ждём таймаута, сообщаем сразу.
                break
            await _handle_client_event(user.id, data)
    except WebSocketDisconnect:
        logger.debug("Пользователь %s отключился от событийного канала", user.id)
    finally:
        fallback_task.cancel()
        await events_manager.disconnect(user.id, websocket)
        # «Не в сети» — только если это было последнее соединение пользователя
        # (иначе новое соединение/другая вкладка уже сообщили «в сети»).
        if events_manager.is_online(user.id):
            return

        await _report_presence(user.id, online=False)
