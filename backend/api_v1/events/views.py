"""WebSocket-эндпоинт событийного канала мессенджера.

Клиент подключается к ``/api/v1/ws/events?token=<jwt>``. Сервер присылает
события:

* ``message.new``  — новое сообщение в чате;
* ``message.changed`` — изменилось сообщение (kind: pin/reaction/deleted/...);
* ``chat.new`` — с пользователем начат новый чат;
* ``chat.read`` — собеседник прочитал сообщения чата;
* ``presence`` — пользователь стал «в сети» / «не в сети»;
* ``presence.snapshot`` — снимок статусов собеседников при подключении.

Присутствие — это только явное состояние (сокет у экрана или нет): время
последней активности (`last_seen`) клиент показывает как «был(а) только что»,
а не как «в сети».
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
from .service import (
    chat_member_ids,
    dispatch_realtime,
    presence_peer_ids,
    presence_snapshot,
)

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

#: Виды активности собеседника (``typing.kind``). Держать согласованным с
#: `frontend/src/utils/peerActivity.ts`: клиент показывает по ним подпись
#: («записывает голосовое…», «отправляет видео…»), а тест
#: `frontend/src/__tests__/peerActivity.spec.ts` сверяет списки.
TYPING_KINDS = frozenset({"text", "voice", "video_note", "photo", "video", "file"})
TYPING_KIND_DEFAULT = "text"


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
    await dispatch_realtime(peer_ids, payload)


async def _handle_client_event(user_id: int, data: Any) -> None:
    """Обрабатывает события от клиента (индикатор активности собеседника).

    ``typing``/``typing-stop`` ретранслируются участникам чата, кроме автора.
    У ``typing`` есть вид активности (``kind``): «печатает…», «записывает
    голосовое…», «отправляет видео…» и т.п. События без вида (старый клиент)
    считаются набором текста.
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

    payload: dict[str, Any] = {
        "type": event_type,
        "chat_id": chat_id,
        "user_id": user_id,
    }
    if event_type == "typing":
        kind = data.get("kind", TYPING_KIND_DEFAULT)
        # Неизвестный вид приводим к набору текста: список открыт для клиента, но
        # пересылать собеседнику произвольную строку из сети нельзя.
        payload["kind"] = kind if kind in TYPING_KINDS else TYPING_KIND_DEFAULT

    async with db_helper.session_factory() as session:
        members = await chat_member_ids(session, chat_id)
    if user_id not in members:
        return
    recipients = [member_id for member_id in members if member_id != user_id]
    await dispatch_realtime(recipients, payload)


async def _presence_last_seen(user_id: int) -> tuple[datetime | None, list[int]]:
    """Время ухода и участники общих чатов (для рассылки `presence`)."""
    async with db_helper.session_factory() as session:
        current = await get_user_by_id(session, user_id)
        if current is None:
            return None, []
        current.last_seen = datetime.now(timezone.utc)
        await session.commit()
        # Присутствие скрыто — о переходах «в сети/ушёл» не рассказываем никому,
        # а снимок присутствия отфильтрован отдельно (см. events.service).
        if current.presence_hidden:
            return current.last_seen, []
        peers = await presence_peer_ids(session, user_id)
        return current.last_seen, peers


async def _report_presence(user_id: int, *, online: bool, reason: str = "") -> None:
    """Сообщает участникам общих чатов, что человек у экрана/ушёл.

    «Ушёл» всегда с обновлённым `last_seen`: собеседник видит «был(а) только что»,
    а не старое время (например, когда приложение было свёрнуто).

    Каждый переход пишется в лог с причиной: без этого нельзя объяснить
    «я вижу его онлайн, хотя он свёрнул приложение» или «статус мигает».
    """
    try:
        last_seen, peers = await _presence_last_seen(user_id)
        logger.info(
            "Присутствие %s: %s%s",
            user_id,
            "в сети" if online else "не в сети",
            f" ({reason})" if reason else "",
        )
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

    # Снимок присутствия: свежеподключённый клиент (например, после перезагрузки
    # страницы) сразу знает, кто у экрана, а не угадывает по `last_seen`.
    try:
        async with db_helper.session_factory() as session:
            snapshot = await presence_snapshot(session, user.id)
        if snapshot:
            await websocket.send_json({"type": "presence.snapshot", "users": snapshot})
    except Exception:  # noqa: BLE001 - снимок некритичен для соединения
        logger.exception("Не удалось отправить снимок присутствия для %s", user.id)

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
            await _report_presence(user.id, online=True, reason="подключение")

    fallback_task = asyncio.create_task(auto_present())

    try:
        # Сервер в основном пушит события; от клиента принимаем typing/typing-stop,
        # а также heartbeat (`ping`), активность (`activity`) и прощание (`bye`).
        last_touch = 0.0
        idle_timeout = False
        bye_received = False
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
                idle_timeout = True
                break
            if isinstance(data, dict) and data.get("type") == "activity":
                # Свёрнутое приложение — это «не в сети»: человек в другом окне.
                active = data.get("active") is not False
                last_seen_confirmed = True
                if await events_manager.set_active(user.id, websocket, active):
                    await _report_presence(
                        user.id,
                        online=active,
                        reason=(
                            "активность клиента" if active else "приложение свёрнуто"
                        ),
                    )
                continue
            if isinstance(data, dict) and data.get("type") in ("ping", "pong"):
                # Заодно освежаем время последней активности (собеседники видят
                # его по `last_seen`, когда пользователь не в сети).
                now = time.monotonic()
                if now - last_touch >= WS_LAST_SEEN_TOUCH_SECONDS:
                    last_touch = now
                    # Только если человек у экрана: иначе свёрнутое приложение
                    # «освежает» last_seen и собеседник часами видит «был(а) только
                    # что», хотя приложение просто лежит в фоне.
                    if events_manager.is_present(user.id):
                        async with db_helper.session_factory() as session:
                            current = await get_user_by_id(session, user.id)
                            if current is not None:
                                await touch_last_seen(current, session)
                continue
            if isinstance(data, dict) and data.get("type") == "bye":
                # Человек уходит со страницы: не ждём таймаута, сообщаем сразу.
                bye_received = True
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

        if idle_timeout:
            reason = "канал молчит — сеть/приложение уснули"
        elif bye_received:
            reason = "клиент попрощался"
        else:
            reason = "канал закрыт"
        await _report_presence(user.id, online=False, reason=reason)
