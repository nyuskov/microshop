"""WebSocket-эндпоинт сигналинга звонков (WebRTC).

Клиент подключается к ``/api/v1/ws/calls?token=<jwt>`` и обменивается JSON:
``call-offer``, ``call-answer``, ``ice-candidate``, ``call-cancel``,
``call-decline``, ``call-end``, ``call-renegotiate``, ``call-renegotiate-answer``,
``call-screen``. Сервер пересылает сообщения адресату.

Если получатель offer офлайн (приложение закрыто) — вызов «паркуется»: когда он
откроет приложение и подключится, offer доставится, и звонок его дождётся. Если
у абонента есть push-канал (Web Push для PWA или RuStore Push для Android) —
дополнительно шлётся уведомление «Вам звонят…»; без уведомления зовущему
сообщается об этом (``call-parked`` с ``notified=false``), но вызов всё равно
ждёт в парковке.

Короткий обрыв сигнального канала (смена сети, перезапуск страницы) не теряет
сообщения: не доставленный ответ на звонок и ICE-кандидаты придерживаются в
менеджере и уходят адресату, когда он подключится снова. Иначе у зовущего звонок
продолжал бы звонить, хотя собеседник уже нажал «Ответить».
"""

import asyncio
import logging
import time
from collections.abc import Coroutine
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.calls import crud as calls_crud
from api_v1.chats.crud import get_private_chat_id_between
from api_v1.events.service import notify_chat
from api_v1.moderation import crud as moderation_crud
from api_v1.push import crud as push_crud
from core import rustore_push
from core.amqp import publish_realtime_event, wait_for_delivery
from core.config import settings
from core.models import Chat, Message, User, db_helper, user_chat_association_table

from ..auth.utils import get_current_user, resolve_user_from_websocket
from .manager import CALL_OVER_QUEUE_TTL_SECONDS, call_manager
from .schemas import CallHistoryItem, CallHistoryResponse
from .turn import ice_servers, turn_configured

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["Calls"])
# REST-роутер звонков (для push-кнопки «Отклонить» из service worker).
router_rest = APIRouter(prefix="/calls", tags=["Calls"])

#: Сколько записей истории звонков отдаём за раз и сколько максимум попросить.
CALL_HISTORY_PAGE = 50
CALL_HISTORY_MAX = 100


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


class CallLeaveRequest(BaseModel):
    """Уход из звонка: страница закрывается или перезагружается."""

    call_id: str = ""
    #: Кого предупредить. В группе клиент знает всех участников набора.
    to_user_ids: list[int] = []
    group: bool = False
    chat_id: int | None = None


class CallLeaveCancelRequest(BaseModel):
    """Страница вернулась (перезагрузка) — завершать звонок не нужно."""

    call_id: str = ""


@router_rest.get("/pending/")
async def pending_call(
    call_id: str = "",
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    """Ждёт ли ещё этого человека входящий вызов.

    Нужно экрану «Входящий звонок…», который открывается из уведомления, пока
    сигнальный канал ещё не поднялся (см. ``park_offer``). Уведомление может быть
    устаревшим: звонок давно отклонили, приняли на другом устройстве или зовущий
    отменил вызов — тогда ждать ответа нечего, и экран должен закрыться сразу, а
    не показывать «Входящий звонок…» до таймаута.

    ``ringing`` — звонок ещё звонит и не принят (offer ушёл, ответа не было). Это
    ответ на другой вопрос: в парковке вызов лежит только когда приложение
    закрыто, а если оно просто свёрнуто — offer доставлен и парковки нет.
    Кнопкам уведомления (отказ, смахивание) нужно именно ``ringing``: иначе отказ
    не работал бы у того, кто свернул приложение.
    """
    if not call_id:
        return {"pending": False, "ringing": False}
    pending = await call_manager.has_pending_offer(user.id, call_id)
    return {"pending": pending, "ringing": _is_call_ringing(call_id, user.id)}


def _is_call_ringing(call_id: str, callee_id: int) -> bool:
    """Звонит ли ещё вызов этому человеку (offer доставлен, ответа не было)."""
    meta = _active_calls.get(call_id)
    if meta is None or meta.get("callee") != callee_id:
        return False
    return meta.get("started") is None


@router_rest.post("/decline/")
async def decline_call(
    payload: CallDeclineRequest,
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    """Отклоняет входящий звонок, не открывая приложение."""
    # Снимаем припаркованный offer получателя, если он ещё «висит».
    await call_manager.discard_pending_offer(user.id, payload.call_id)
    # Отказ из уведомления идёт мимо релея (напрямую в сокет зовущего), поэтому
    # исход звонка фиксируем здесь же — иначе в истории чата не оставалось бы
    # следа: зовущий видел «отклонил», а записи о звонке нет.
    await _track_call_event(
        "call-decline",
        user.id,
        payload.to_user_id,
        {"call_id": payload.call_id, "reason": "declined"},
    )
    # На других устройствах этого же человека звонок тоже должен замолчать.
    _notify_call_finished(user.id, payload.call_id, "declined")
    envelope = {
        "type": "call-decline",
        "call_id": payload.call_id,
        "to_user_id": payload.to_user_id,
        "from_user_id": user.id,
        "reason": "declined",
    }
    delivered = await _deliver_signal(payload.to_user_id, envelope)
    if not delivered:
        # Канал зовущего молчит (приложение в фоне, смена сети): придержим отказ
        # до подключения.
        await call_manager.queue_message(
            payload.to_user_id, envelope, CALL_OVER_QUEUE_TTL_SECONDS
        )
    # И ТИХИЙ PUSH ЗОВУЩЕМУ — независимо от того, нашёлся ли живой сокет.
    #
    # Симптом из жизни: абонент смахивает уведомление (отказ уходит сюда, запись
    # в истории появляется), а у зовущего вызов продолжает звонить. Причина:
    # `send_to_user` мог найти устаревший сокет и вернуть «доставлено», хотя
    # окно, которое звенит, сообщение не обработало. Push приходит в service
    # worker и при мёртвом WebSocket: он гасит уведомление и просит приложение
    # прекратить звонок (`finishIfRinging`).
    _notify_call_finished(payload.to_user_id, payload.call_id, "declined")
    # А СВОИМ устройствам — ещё и по сигнальному каналу.
    #
    # У абонента окно звонка тоже должно закрыться сразу, а не по таймауту:
    # он смахнул уведомление, но вызов ещё «звонит» в приложении. Раньше
    # надеялись только на push (у него может не быть подписки, его может съесть
    # Doze), и звонок оставался висеть. `call-end` — обычное завершение: стор
    # гасит звонок и показывает «Звонок завершён» (см. `stores/call.ts`).
    local_end = {
        "type": "call-end",
        "call_id": payload.call_id,
        "to_user_id": payload.to_user_id,
        "from_user_id": user.id,
        "reason": "declined",
    }
    if not await _deliver_signal(user.id, local_end):
        await call_manager.queue_message(
            user.id, local_end, CALL_OVER_QUEUE_TTL_SECONDS
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
        # Состояние микрофона и камеры собеседника: выключенную камеру показываем
        # как «камера выключена», а не как чёрный экран (и не принимаем за обрыв).
        "call-media-state",
        # Возврат собеседника в идущий звонок после перезагрузки страницы: у него
        # новое соединение и новые ICE-адреса, поэтому вторая сторона
        # пересогласовывает SDP (иначе звонок выглядел бы сброшенным).
        "call-rejoin",
        # Групповой звонок: участник сбрасывает того, кто так и не взял трубку.
        "call-drop",
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
        await _persist_call_record(meta, _decline_state(data), 0)
    elif message_type == "call-cancel":
        await _persist_call_record(meta, "missed", 0)


# ---------- Групповой звонок «mesh» (до 4 участников) ----------
#
# Схема полносвязная: каждый участник держит отдельное соединение с каждым
# (3–4 человека — это 6 пар максимум, SFU на таких числах не нужен). Сервер
# остаётся ретранслятором: клиент адресует SDP конкретному участнику
# (`to_user_id`), а `group=true` в offer сообщает, что вызов общий для чата.
#
# Что сервер обязан проверить сам (клиенту нельзя доверять): что чат
# групповой, что оба участника в нём состоят и что в звонке не больше
# четырёх человек. Из-за лимита растёт трафик и нагрузка на слабых телефонах,
# поэтому пятый получает «занято», ещё не начиная соединяться.

#: Предел участников группового звонка.
MAX_GROUP_CALL_PARTICIPANTS = 4

#: Кто в каком групповом звонке: `call_id` -> участники. Живёт в памяти
#: процесса, как и ``_active_calls``: сигналинг идёт через живые сокеты.
_group_calls: dict[str, set[int]] = {}


async def _group_chat_member_ids(chat_id: int) -> set[int] | None:
    """Участники группового чата; ``None`` — чата нет или он не групповой.

    Ошибка БД не должна ронять сигналинг: считаем, что проверить не удалось, и
    звонок не пропускаем (как и с блокировками — важнее не сломать связь).
    """
    try:
        async with db_helper.session_factory() as session:
            chat = await session.get(Chat, chat_id)
            if chat is None or not chat.is_group:
                return None
            rows = await session.execute(
                select(user_chat_association_table.c.user_id).where(
                    user_chat_association_table.c.chat_id == chat_id
                )
            )
            return set(rows.scalars().all())
    except Exception:  # noqa: BLE001 - проверка чата не роняет сигналинг
        logger.exception("Не удалось проверить участников группового чата")
        return None


async def _admit_group_call(
    data: dict[str, Any], from_user_id: int, to_user_id: int
) -> tuple[bool, str]:
    """Можно ли позвать человека в этот групповой звонок.

    Возвращает ``(можно, причина_отказа)``. Причина — для сообщения зовущему:
    «full» (в звонке уже четверо) или «forbidden» (чата нет / не участник).
    """
    raw_chat_id = data.get("chat_id")
    try:
        chat_id = int(raw_chat_id)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False, "forbidden"

    members = await _group_chat_member_ids(chat_id)
    if members is None or from_user_id not in members or to_user_id not in members:
        return False, "forbidden"

    call_id = str(data.get("call_id") or "")
    if not call_id:
        return False, "forbidden"

    participants = _group_calls.setdefault(call_id, set())
    # Чат помним отдельно: после выхода участника остальным нужно разослать
    # актуальный состав, а в `_group_calls` лежат только id (см.
    # `_schedule_call_end`).
    _group_call_chats[call_id] = chat_id
    # Место зовущего считается занятым: он уже в звонке, даже если это его
    # первый offer в этом наборе.
    if (
        to_user_id not in participants
        and len(participants) >= MAX_GROUP_CALL_PARTICIPANTS
    ):
        return False, "full"

    participants.add(from_user_id)
    participants.add(to_user_id)
    return True, ""


def _leave_group_call(data: dict[str, Any], user_id: int) -> None:
    """Убирает участника из группового звонка (завершил/отклонил/отменил)."""
    call_id = str(data.get("call_id") or "")
    if not call_id:
        return
    participants = _group_calls.get(call_id)
    if participants is None:
        return
    participants.discard(user_id)
    if not participants:
        _group_calls.pop(call_id, None)
        _group_call_chats.pop(call_id, None)


def _group_call_peers(call_id: str) -> list[int]:
    """Кто сейчас в групповом звонке (по возрастанию id — порядок для клиента)."""
    return sorted(_group_calls.get(call_id, set()))


async def _broadcast_group_peers(call_id: str, chat_id: int) -> None:
    """Сообщает участникам, кто в звонке.

    Без этого списка «mesh» не собрать: каждый держит соединение с каждым, и
    клиенты должны знать, с кем ещё соединяться. Младший по id инициирует
    соединение сам — правило простое и без конфликтов (см. стор звонков).
    """
    peers = _group_call_peers(call_id)
    if not peers:
        return
    for peer_id in peers:
        await _deliver_signal(
            peer_id,
            {
                "type": "call-peers",
                "call_id": call_id,
                "chat_id": chat_id,
                "group": True,
                "peers": peers,
            },
        )


def _decline_state(data: dict[str, Any]) -> str:
    """Исход звонка по отказному сообщению (``call-decline``).

    «Отклонить» — только осознанный отказ человека (``reason`` отсутствует или
    ``declined``). Неудачная попытка принять (``failed``: нет доступа к камере или
    микрофону) и «занят» (``busy``) — это не отказ: человек как раз пытался
    ответить, поэтому в истории звонок записываем пропущенным. Иначе «принять»
    выглядело бы как «отклонить» — и у собеседника, и в истории чата.
    """
    reason = str(data.get("reason") or "declined")
    return "declined" if reason == "declined" else "missed"


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


# ---------- Звонок не «висит» у собеседника после ухода ----------
#
# Симптом (владелец, 24.09.2026): «закрываю приложение — у меня звонок
# разрывается, а у собеседника продолжается». Ушедшая страница отправить уже
# ничего не может, а сигнальный канал обрывается молча: сервер просто забывает
# сокет, и вторая сторона продолжает «разговор» с тишиной. Её собственный сторож
# срабатывает не всегда: в свёрнутом приложении браузер душит таймеры.
#
# Поэтому завершение планирует СЕРВЕР. Мгновенно рвать нельзя: перезагрузка
# страницы закрывает сигнальный канал точно так же, а звонок после неё
# поднимается заново (`call-rejoin`, см. stores/call/session.ts) — на слабом
# телефоне это занимает секунды. Значит, завершение откладывается, а вернувшийся
# клиент его отменяет:
#
# * явный уход (`POST /calls/leave/` из `pagehide`, окно
#   ``CALL_LEAVE_GRACE_SECONDS``): отмену присылает сама возвращающаяся вкладка,
#   причём ДО загрузки бандла (`public/theme-boot.js`) — иначе на слабом телефоне
#   окно успевало истечь;
# * молча оборвавшийся канал (``CALL_SIGNAL_LOST_GRACE_SECONDS``) — страховка на
#   случай, когда приложение выгрузила система (просьбы от страницы не было).
#
# Отменяют завершение: новое подключение сигнального канала, любое сигнальное
# сообщение этого человека по этому вызову и запрос `/calls/leave/cancel/`.

#: Сколько ждём возвращения страницы, прежде чем завершить звонок у собеседника.
#: Окно короткое: уход явный, а отмену возвращающаяся вкладка присылает первым
#: же запросом — до того, как загрузится само приложение.
CALL_LEAVE_GRACE_SECONDS = 5.0
#: То же окно для молча оборвавшегося канала (страницу могла выгрузить система).
#: Ждём дольше: холодный старт на слабом телефоне занимает секунды, и звонок
#: после перезагрузки обязан выжить — иначе «звонок срывается при перезагрузке».
CALL_SIGNAL_LOST_GRACE_SECONDS = 25.0

#: Запланированные завершения: `(call_id, user_id)` → (задача, срок).
_pending_call_ends: dict[tuple[str, int], tuple[asyncio.Task[None], float]] = {}
#: Чат группового звонка: в `_group_calls` лежат только участники, а после выхода
#: одного из них остальным нужно разослать состав (для этого нужен `chat_id`).
_group_call_chats: dict[str, int] = {}


def _cancel_call_end(call_id: str, user_id: int) -> None:
    """Человек вернулся: завершать звонок не нужно.

    Пустой ``call_id`` — «отменить всё, что ждём по этому человеку»: так
    сигнальный канал, подключившись заново, снимает и уход, и обрыв (в запросе
    на подключение номера вызова нет).
    """
    if not call_id:
        for key in [key for key in _pending_call_ends if key[1] == user_id]:
            pending = _pending_call_ends.pop(key, None)
            if pending is not None:
                pending[0].cancel()
        return
    pending = _pending_call_ends.pop((call_id, user_id), None)
    if pending is not None:
        pending[0].cancel()


def _schedule_call_end(
    call_id: str,
    user_id: int,
    delay: float,
    reason: str,
    *,
    targets: list[int],
    group: bool,
    chat_id: int | None,
) -> None:
    """Планирует завершение звонка, если человек так и не вернётся.

    ``reason`` уходит собеседникам как причина: ``left`` (страница ушла по своей
    воле) или ``signal-lost`` (канал замолчал) — приложение по ним показывает
    «собеседник отключился» вместо «звонок завершён».
    """
    if not call_id or not user_id:
        return
    key = (call_id, user_id)
    pending = _pending_call_ends.get(key)
    if pending is not None and not pending[0].done():
        # Уже ждём. Раньше срока НЕ переносим: у явного ухода окно короче, чем у
        # оборвавшегося канала, а прийти эти поводы могут в любом порядке
        # (`pagehide` и закрытие сокета случаются одновременно).
        if pending[1] <= time.monotonic() + delay:
            return
        pending[0].cancel()
    task = asyncio.create_task(
        _end_call_after_user_left(
            call_id,
            user_id,
            delay,
            reason,
            targets=targets,
            group=group,
            chat_id=chat_id,
        )
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    _pending_call_ends[key] = (task, time.monotonic() + delay)


async def _end_call_after_user_left(
    call_id: str,
    user_id: int,
    delay: float,
    reason: str,
    *,
    targets: list[int],
    group: bool,
    chat_id: int | None,
) -> None:
    """Завершает звонок у собеседников: человек ушёл и не вернулся."""
    await asyncio.sleep(delay)
    # Себя из ожидающих убираем ПЕРВЫМ делом: возвращение клиента в этот момент
    # уже не должно обрывать рассылку на половине (отмена — только до начала).
    _pending_call_ends.pop((call_id, user_id), None)

    # Что знает ЭТОТ процесс — уточняет картину: настоящий состав группы и исход
    # для истории чата (список от клиента может быть неполным).
    participants = _group_calls.get(call_id)
    meta = _active_calls.get(call_id)
    if participants and user_id in participants:
        group = True
        targets = [item for item in participants if item != user_id]
        chat_id = _group_call_chats.get(call_id) or chat_id
        _leave_group_call({"call_id": call_id}, user_id)
        if chat_id and _group_calls.get(call_id):
            _spawn(_broadcast_group_peers(call_id, chat_id))
    elif meta is not None and user_id in (meta.get("caller"), meta.get("callee")):
        other = meta["callee"] if meta.get("caller") == user_id else meta["caller"]
        if other:
            targets = [other]
    peers = sorted({item for item in targets if item and item != user_id})
    # Своя парковка (нам ещё «звонили») больше не нужна: вызова нет.
    await call_manager.discard_pending_offer(user_id, call_id)
    if peers:
        await _tell_peers_call_is_over(
            call_id,
            user_id,
            peers,
            meta,
            reason=reason,
            group=group,
            chat_id=chat_id,
        )
    _forget_finished_call(call_id, user_id, meta)


async def _tell_peers_call_is_over(
    call_id: str,
    user_id: int,
    peers: list[int],
    meta: dict[str, Any] | None,
    *,
    reason: str,
    group: bool,
    chat_id: int | None,
) -> None:
    """Сообщает собеседникам, что звонок закончился (и будит их push'ом)."""
    # Зовущий снял ещё не принятый вызов — это ОТМЕНА: у абонента окно входящего
    # закроется со смыслом «зовущий передумал», как при `call-cancel`.
    ringing_outgoing = (
        not group
        and meta is not None
        and meta.get("started") is None
        and meta.get("caller") == user_id
    )
    message_type = "call-cancel" if ringing_outgoing else "call-end"
    for peer_id in peers:
        envelope: dict[str, Any] = {
            "type": message_type,
            "call_id": call_id,
            "from_user_id": user_id,
            "to_user_id": peer_id,
            "reason": reason,
        }
        if group:
            envelope["group"] = True
            if chat_id:
                envelope["chat_id"] = chat_id
        await call_manager.discard_pending_offer(peer_id, call_id)
        if not await _deliver_signal(peer_id, envelope):
            # Канал собеседника молчит — придержим до подключения (как и для
            # обычного `call-end`), иначе он узнает о конце только по таймауту.
            await call_manager.queue_message(
                peer_id, envelope, CALL_OVER_QUEUE_TTL_SECONDS
            )
        # И тихий push: у свёрнутого приложения сигналинг живой не всегда, а
        # уведомление «Вам звонят» там продолжает звонить.
        _notify_call_finished(peer_id, call_id, "ended")


def _forget_finished_call(
    call_id: str, user_id: int, meta: dict[str, Any] | None
) -> None:
    """Убирает память о закончившемся звонке и пишет исход в историю чата."""
    _pending_call_ends.pop((call_id, user_id), None)
    if _active_calls.get(call_id) is meta and meta is not None:
        _active_calls.pop(call_id, None)
    if not _group_calls.get(call_id):
        _group_call_chats.pop(call_id, None)
    if meta is None or user_id not in (meta.get("caller"), meta.get("callee")):
        return
    # Запись в истории чата — какую сделал бы `_track_call_event` по `call-end`:
    # состоявшийся разговор — «завершён» с длительностью, несостоявшийся —
    # «пропущен» (человек не дождался ответа).
    if meta.get("started") is not None:
        started = meta["started"]
        duration = max(0, int((datetime.now(timezone.utc) - started).total_seconds()))
        _spawn(_persist_call_record(meta, "completed", duration))
    else:
        _spawn(_persist_call_record(meta, "missed", 0))


def _schedule_call_ends_after_signal_loss(user_id: int) -> None:
    """Сигнальный канал закрылся: если человек в звонке, готовим завершение.

    Именно закрытие канала отличает «приложение свернули» (канал живой, звонок
    продолжается) от «приложение закрыли или выгрузила система» — во втором
    случае просьбы от страницы может не быть вовсе.
    """
    if not user_id:
        return
    for call_id, meta in list(_active_calls.items()):
        if user_id in (meta.get("caller"), meta.get("callee")):
            _schedule_call_end(
                call_id,
                user_id,
                CALL_SIGNAL_LOST_GRACE_SECONDS,
                "signal-lost",
                targets=[],
                group=False,
                chat_id=None,
            )
    for call_id, participants in list(_group_calls.items()):
        if user_id in participants:
            _schedule_call_end(
                call_id,
                user_id,
                CALL_SIGNAL_LOST_GRACE_SECONDS,
                "signal-lost",
                targets=[],
                group=True,
                chat_id=_group_call_chats.get(call_id),
            )


@router_rest.post("/leave/")
async def leave_call(
    payload: CallLeaveRequest, user: User = Depends(get_current_user)
) -> dict[str, bool]:
    """«Моя страница уходит»: предупреждаем собеседников, если я не вернусь.

    Клиент зовёт это из `pagehide` (см. `stores/call.ts`): страница выгружается и
    отправить что-либо сама уже не может, поэтому решение отдаём серверу — он
    подождёт `CALL_LEAVE_GRACE_SECONDS` и завершит звонок, если человек не
    вернулся. Перезагрузка страницы идёт тем же путём, но её отменяет сама
    возвращающаяся вкладка (`public/theme-boot.js`) — звонок после перезагрузки
    обязан выжить.
    """
    targets = [item for item in payload.to_user_ids if item and item != user.id]
    if not payload.call_id or not targets:
        return {"ok": False}
    _schedule_call_end(
        payload.call_id,
        user.id,
        CALL_LEAVE_GRACE_SECONDS,
        "left",
        targets=targets,
        group=payload.group,
        chat_id=payload.chat_id,
    )
    return {"ok": True}


@router_rest.post("/leave/cancel/")
async def cancel_call_leave(
    payload: CallLeaveCancelRequest, user: User = Depends(get_current_user)
) -> dict[str, bool]:
    """Отменяет запланированное завершение звонка: страница вернулась."""
    _cancel_call_end(payload.call_id, user.id)
    return {"ok": True}


async def _deliver_signal(user_id: int, envelope: dict[str, Any]) -> bool:
    """Отдаёт сигнальное сообщение абоненту — где бы он ни был подключён.

    Сокет живёт в конкретном процессе web, а при нескольких процессах (деплой
    «синий/зелёный», масштабирование) человек может быть на связи в ДРУГОМ
    процессе. Поэтому после неудачной локальной попытки публикуем сигнал в мост и
    ждём подтверждения доставки: его присылает тот процесс, который раздал сигнал
    в живой сокет.

    ``False`` — абонент нигде не подключён; вызывающий по этому признаку паркует
    вызов или придерживает сообщение (поведение офлайн-абонента не меняется).
    """
    if await call_manager.send_to_user(user_id, envelope):
        return True
    try:
        event_id = await publish_realtime_event(envelope, [user_id], ack_requested=True)
    except Exception:  # noqa: BLE001 - без моста остаётся хотя бы локальная доставка
        logger.exception("Не удалось отправить сигнал звонка через мост")
        return False
    return await wait_for_delivery(event_id)


async def _deliver_to_devices(
    user_id: int, envelope: dict[str, Any], *, exclude: WebSocket | None = None
) -> None:
    """Сообщение на остальные устройства человека (и за пределы процесса).

    Локально исключаем соединение-источник (на нём действие уже выполнено), а в
    мост отправляем всем: устройства того же человека могут быть подключены к
    другому процессу web, и тогда они остались бы «звенеть». Пришедшее из моста
    событие на устройстве-источнике безвредно: приложение сверяет номер вызова и
    гасит только ещё не принятый вызов.
    """
    await call_manager.send_to_other_devices(user_id, envelope, exclude=exclude)
    try:
        await publish_realtime_event(envelope, [user_id])
    except Exception:  # noqa: BLE001 - остальные устройства получат хотя бы локально
        logger.exception("Не удалось разослать сигнал звонка по другим устройствам")


async def _is_call_blocked(from_user_id: int, to_user_id: int) -> bool:
    """Блокировка между участниками звонка (в любую сторону).

    Проверка обязательна: заблокированный не должен ни дозвониться, ни получить
    push «Вам звонят…». Учитывается и мягкая блокировка («только звонки») —
    человек как раз и просил не звонить. Ошибка БД не должна ронять сигналинг:
    тогда просто пропускаем вызов, как раньше.
    """
    try:
        async with db_helper.session_factory() as session:
            return await moderation_crud.is_call_blocked_between(
                session, user_id=to_user_id, other_id=from_user_id
            )
    except Exception:  # noqa: BLE001 - блокировки не роняют сигналинг
        logger.exception("Не удалось проверить блокировки для звонка")
        return False


async def _relay_message(
    from_user_id: int, data: dict[str, Any], sender: WebSocket | None = None
) -> None:
    """Пересылает сообщение сигналинга от одного участника другому.

    ``sender`` — соединение, от которого пришло сообщение: на остальные
    устройства этого же человека уходит «ответили в другом месте» (см. ниже).
    """
    raw_target = data.get("to_user_id")
    try:
        to_user_id = int(raw_target)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return

    # Человек снова на связи по этому вызову — запланированное завершение
    # отменяем (см. `_schedule_call_end`). Достаточно ЛЮБОГО его сообщения о
    # звонке: `call-rejoin` после перезагрузки, ответ, ICE-адреса.
    _cancel_call_end(str(data.get("call_id") or ""), from_user_id)

    envelope = dict(data)
    envelope["from_user_id"] = from_user_id
    message_type = data.get("type")

    # Ответили или отклонили на одном устройстве — на остальных устройствах
    # этого же человека звонок должен замолчать (там он тоже звенит).
    if message_type in ("call-answer", "call-decline"):
        await _deliver_to_devices(
            from_user_id,
            {
                "type": "call-ended-elsewhere",
                "call_id": data.get("call_id"),
                "to_user_id": to_user_id,
                "from_user_id": from_user_id,
                "reason": _elsewhere_reason(message_type, data),
            },
            exclude=sender,
        )
        # И тихий push: у устройств с ЗАКРЫТЫМ приложением сигналинга нет, а
        # уведомление «Вам звонят» там висит до тапа. Пусть закроют и перестанут
        # «звонить», если этот вызов у них ещё входящий.
        _notify_call_finished(
            from_user_id, data.get("call_id"), _elsewhere_reason(message_type, data)
        )
    elif message_type == "call-cancel":
        # Зовущий передумал: у абонента уведомление тоже должно исчезнуть, а
        # экран звонка — закрыться, даже если его канал уже отвалился.
        _notify_call_finished(to_user_id, data.get("call_id"), "cancelled")

    # Заблокированная пара не звонит друг другу: сообщение не пересылаем, вызов не
    # паркуем и push не шлём. Зовущему отвечаем как при недоступности — о самом
    # факте блокировки не сообщаем.
    if await _is_call_blocked(from_user_id, to_user_id):
        if message_type == "call-offer":
            await call_manager.send_to_user(
                from_user_id,
                {
                    "type": "call-unavailable",
                    "call_id": data.get("call_id"),
                    "to_user_id": to_user_id,
                    "from_user_id": to_user_id,
                },
            )
        await call_manager.discard_pending_offer(to_user_id, data.get("call_id"))
        return

    if message_type in _CALL_TRACK_TYPES:
        await _track_call_event(message_type, from_user_id, to_user_id, data)

    # Групповой звонок «mesh»: пускаем только участников группы и не больше
    # четырёх человек. Проверку делает сервер — клиенту тут доверять нельзя
    # (иначе чужой чат или пятый участник получили бы сигналинг).
    if data.get("group"):
        if message_type == "call-offer":
            allowed, reason = await _admit_group_call(data, from_user_id, to_user_id)
            if not allowed:
                await call_manager.send_to_user(
                    from_user_id,
                    {
                        "type": "call-unavailable",
                        "call_id": data.get("call_id"),
                        "to_user_id": to_user_id,
                        "from_user_id": to_user_id,
                        "reason": reason,
                    },
                )
                return
            # Состав звонка изменился — говорим об этом всем участникам, чтобы
            # они соединились с новым человеком (mesh: каждый с каждым).
            call_id = str(data.get("call_id") or "")
            chat_id = int(data.get("chat_id") or 0)
            if call_id:
                _spawn(_broadcast_group_peers(call_id, chat_id))
        elif message_type == "call-answer":
            # Кто-то поднял трубку. Состав звонка не изменился, но связи между
            # участниками нужно достроить: offer «среднего» участника мог прийти,
            # пока человек ещё не ответил, и был проигнорирован как «этот же
            # звонок» — тогда двое так и не слышали друг друга. Рассылаем состав,
            # по нему клиенты повторяют недостающие связи.
            call_id = str(data.get("call_id") or "")
            chat_id = int(data.get("chat_id") or 0)
            if call_id:
                _spawn(_broadcast_group_peers(call_id, chat_id))
        elif message_type in ("call-end", "call-cancel", "call-decline"):
            _leave_group_call(data, from_user_id)
            call_id = str(data.get("call_id") or "")
            chat_id = int(data.get("chat_id") or 0)
            if call_id and _group_calls.get(call_id):
                # Остальные продолжают разговор: сообщаем актуальный состав.
                _spawn(_broadcast_group_peers(call_id, chat_id))
        elif message_type == "call-drop":
            # Кто-то из участников сбрасывает того, кто так и не поднял трубку:
            # выкидываем его из состава и гасим у него окно вызова (сам он этого
            # сообщения не увидит — оно адресовано тому, кого сбрасывают).
            # Сбрасывать может любой участник ЧАТА, а не только инициатор: в
            # разговоре это обычное дело («этот больше не нужен»).
            call_id = str(data.get("call_id") or "")
            chat_id = int(data.get("chat_id") or 0)
            members = await _group_chat_member_ids(chat_id)
            if (
                call_id
                and members
                and from_user_id in members
                and to_user_id in _group_calls.get(call_id, set())
            ):
                _leave_group_call(data, to_user_id)
                await call_manager.send_to_user(
                    to_user_id,
                    {
                        "type": "call-end",
                        "call_id": data.get("call_id"),
                        "chat_id": data.get("chat_id"),
                        "group": True,
                        "from_user_id": from_user_id,
                        "to_user_id": to_user_id,
                        "reason": "dropped",
                    },
                )
                call_id = str(data.get("call_id") or "")
                chat_id = int(data.get("chat_id") or 0)
                if call_id and _group_calls.get(call_id):
                    _spawn(_broadcast_group_peers(call_id, chat_id))
                # Сам сброс дальше не пересылаем: получателю уже сказано.
                return

    delivered = await _deliver_signal(to_user_id, envelope)
    if delivered:
        # Доставлено — парковка для этого вызова больше не нужна.
        if message_type in ("call-cancel", "call-decline", "call-end"):
            await call_manager.discard_pending_offer(to_user_id, data.get("call_id"))
        return

    # Абонент офлайн.
    if message_type == "call-offer":
        # Вызов паркуем ВСЕГДА, а уведомление шлём, если есть чем будить
        # (Web Push/RuStore Push). Без уведомления человек может открыть
        # приложение сам — звонок его дождётся.
        await _park_offer_and_notify(
            callee_id=to_user_id,
            caller_id=from_user_id,
            offer=envelope,
        )
    elif message_type in ("call-cancel", "call-decline", "call-end"):
        # Отменяем/снимаем «висящий» вызов у офлайн-абонента...
        await call_manager.discard_pending_offer(to_user_id, data.get("call_id"))
        # ...и ПРИДЕРЖИВАЕМ само сообщение. Канал у абонента мог отвалиться
        # прямо во время вызова (телефон в фоне, смена сети): тогда он до сих
        # пор «звонит» — со звуком и окном вызова — и узнает о завершении
        # только по собственному таймауту, а если вкладку заморозили, то и
        # никогда. Придержанное сообщение доставится при подключении (см.
        # `queue_message`/`connect`), и приложение сразу погасит вызов.
        # Срок жизни — с запасом (человек может открыть приложение через
        # несколько минут): сообщение безопасно, приложение сверяет номер вызова.
        await call_manager.queue_message(
            to_user_id, envelope, CALL_OVER_QUEUE_TTL_SECONDS
        )
        # Плюс тихий push: сообщение из очереди дойдёт только при подключении, а
        # звонок «звонит» прямо сейчас. Своё уведомление для `call-cancel` уже
        # отправлено выше; здесь — отказ и завершение, где получатель это
        # зовущий: без сигнала его вызов звенит до собственного таймаута.
        if message_type in ("call-decline", "call-end"):
            _notify_call_finished(
                to_user_id,
                data.get("call_id"),
                "declined" if message_type == "call-decline" else "ended",
            )
    else:
        # Ответ на звонок и ICE-кандидаты: абонент мог отвалиться на секунду
        # (смена сети, перезапуск страницы). Если просто выбросить сообщение,
        # у зовущего звонок продолжит звонить, хотя собеседник уже ответил, —
        # поэтому придерживаем до следующего подключения.
        await call_manager.queue_message(to_user_id, envelope)


#: Пауза перед push о входящем звонке.
#:
#: За это время зовущий может отменить вызов, а абонент — сам открыть приложение
#: и забрать припаркованный offer. Тогда уведомление «Вам звонят» не отправляем:
#: иначе человек получал бы его, когда звонка уже нет (отменён или уже отвечен).
CALL_PUSH_DELAY_SECONDS = 2.0

#: Через сколько секунд ПОВТОРЯЕМ уведомление о звонке и сколько раз всего.
#:
#: Одно уведомление — это один короткий сигнал, а телефон в кармане его легко
#: пропускает. Повтор с тем же ``tag`` и ``renotify`` заставляет систему подать
#: звук и вибрацию снова: вызов «звонит», а не «пискнет» один раз. Повторы идут
#: БЕЗ ``Topic`` — с ним служба push схлопывает их в очередь, и повтор не
#: дозвонится.
#:
#: Шаг короткий: звук системного уведомления длится секунду-две, и вместе с
#: вибрацией повтор занимает почти весь промежуток — телефон именно ЗВОНИТ, а не
#: пищит раз в 20 с (владелец 22.09.2026: сначала «каждые 4 секунды, а не 8»,
#: затем «или даже 3»). Расписание 2 + 3 × 23 = 71 с укладывается и в ожидание
#: зовущего (``RING_OUT_TIMEOUT_MS`` = 75 с на клиенте), и в
#: ``CALL_PUSH_VALID_SECONDS`` = 85 с.
#:
#: Повторов «в пустоту» не бывает: перед каждым сверяемся с парковкой, поэтому
#: принятый, отклонённый или отменённый вызов замолкает сразу.
CALL_PUSH_REPEAT_SECONDS = 3.0
CALL_PUSH_ATTEMPTS = 24
#: Сколько push о звонке остаётся актуальным.
#:
#: Зовущий ждёт ответа 75 секунд (``RING_OUT_TIMEOUT_MS`` на клиенте), и
#: уведомление, пришедшее в этом окне, ещё актуально — человек может успеть
#: ответить. Дольше держать нельзя: иначе «Вам звонят» появляется, когда звонок
#: уже снят (то же правило, что в ``sw.js``).
CALL_PUSH_VALID_SECONDS = 85.0

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


#: Почему звонок завершился на другом устройстве (см. `call-ended-elsewhere`).
#: Отличать причины важно: человек пытался ответить, но не вышло (`failed`) или
#: уже был занят (`busy`) — это не «отклонил», и показывать «звонок отклонён» на
#: втором устройстве этого же человека нельзя.
def _elsewhere_reason(message_type: str, data: dict[str, Any]) -> str:
    """Причина для других устройств: answered / declined / failed / busy."""
    if message_type == "call-answer":
        return "answered"
    reason = str(data.get("reason") or "declined")
    return reason if reason in ("failed", "busy") else "declined"


def _notify_call_finished(
    user_id: int, call_id: object, reason: str = "cancelled"
) -> None:
    """Просит устройства человека закрыть уведомление о звонке и прекратить его.

    Тихий push (без текста): service worker по нему убирает уведомление вызова и
    ничего не показывает, а открытое приложение гасит «звонит», если этот вызов
    у него ещё входящий (см. `callStore.finishIfRinging`). Нужен именно push, а
    не сигналинг: приложение на устройстве может быть закрыто или его канал
    отвалился — а уведомление «Вам звонят» там висит (`requireInteraction` сам
    его не убирает) и звонок продолжает «идти».

    ``reason``: ``cancelled`` (зовущий снял вызов), ``answered``/``declined``/
    ``failed``/``busy`` — исход на другом устройстве.
    """
    if not call_id:
        return
    try:
        from core.celery_app import get_task

        get_task("tasks.notifications.send_call_cancelled_push").delay(
            user_id, str(call_id), reason
        )
    except Exception:  # noqa: BLE001 - push не должен ронять сигналинг
        logger.exception("Не удалось поставить задачу закрытия уведомления о звонке")


async def _enqueue_call_push_when_ringing(
    *, callee_id: int, caller_id: int, offer: dict[str, Any]
) -> None:
    """Ставит push о входящем звонке — и повторяет его, пока вызов «висит».

    Первую проверку делаем с задержкой (``CALL_PUSH_DELAY_SECONDS``) и в том же
    процессе, который держит парковку: отменил зовущий или абонент уже
    подключился — уведомление не нужно, он и так знает о звонке.

    Дальше — серия повторов (``CALL_PUSH_ATTEMPTS`` всего, шаг
    ``CALL_PUSH_REPEAT_SECONDS``): так вызов звенит несколько раз подряд, как
    телефонный. Перед каждым повтором сверяемся с парковкой: ответили, отменили
    или срок вышел — замолкаем.

    ``expires_at`` считаем ОДИН раз, до цикла: иначе каждый повтор продлевал бы
    срок годности, и уведомление «Вам звонят» висело бы уже после того, как
    зовущий перестал ждать.
    """
    call_id = offer.get("call_id")
    expires_at = _call_push_expires_at()
    try:
        from core.celery_app import get_task

        for attempt in range(1, CALL_PUSH_ATTEMPTS + 1):
            delay = (
                CALL_PUSH_DELAY_SECONDS if attempt == 1 else CALL_PUSH_REPEAT_SECONDS
            )
            await asyncio.sleep(delay)
            if not await call_manager.has_pending_offer(callee_id, call_id):
                logger.info(
                    "Звонок %s уже снят — push больше не отправляем (попытка %s)",
                    call_id,
                    attempt,
                )
                return
            get_task("tasks.notifications.send_call_push").delay(
                callee_id,
                call_id,
                caller_id,
                offer.get("kind"),
                expires_at,
                attempt,
                CALL_PUSH_ATTEMPTS,
            )
    except Exception:  # noqa: BLE001 - push не должен ронять сигналинг
        logger.exception("Не удалось поставить задачу push о входящем звонке")


async def _park_offer_and_notify(
    *, callee_id: int, caller_id: int, offer: dict[str, Any]
) -> bool:
    """Паркует вызов офлайн-абоненту и, если есть канал, шлёт push.

    Возвращает ``True``, если уведомление действительно ушло: у абонента есть
    хотя бы один push-канал — Web Push (PWA) или RuStore Push (Android-приложение)
    — и он на него подписан. Без уведомления вызов всё равно остаётся в парковке:
    человек может сам открыть приложение, и звонок его дождётся в течение
    ``park_offer`` (см. ``CallConnectionManager.park_offer``).
    """
    notified = False
    if _any_push_channel_configured():
        async with db_helper.session_factory() as session:
            subscriptions = await push_crud.get_subscriptions_for_users(
                session, [callee_id]
            )
            rustore_tokens = await push_crud.get_rustore_tokens_for_users(
                session, [callee_id]
            )
        notified = bool(subscriptions or rustore_tokens)

    await call_manager.park_offer(callee_id, offer)
    # Собеседник не в сети: говорим зовущему, что происходит, — звонок ждёт
    # (и отправлено ли уведомление), чтобы он не гадал, почему никто не берёт.
    await call_manager.send_to_user(
        caller_id,
        {
            "type": "call-parked",
            "call_id": offer.get("call_id"),
            "to_user_id": callee_id,
            "notified": notified,
        },
    )
    if notified:
        _spawn(
            _enqueue_call_push_when_ringing(
                callee_id=callee_id, caller_id=caller_id, offer=offer
            )
        )
    return notified


async def _handle_message(
    from_user_id: int, data: Any, sender: WebSocket | None = None
) -> None:
    if not isinstance(data, dict):
        return
    if data.get("type") not in RELAY_MESSAGE_TYPES:
        return
    await _relay_message(from_user_id, data, sender)


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


@router_rest.get("/history/", response_model=CallHistoryResponse)
async def call_history(
    limit: int = Query(default=CALL_HISTORY_PAGE, ge=1, le=CALL_HISTORY_MAX),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> CallHistoryResponse:
    """История звонков человека: записи по всем личным чатам, свежие первыми.

    Отдельного хранилища нет: звонки — это системные сообщения `kind='call'`
    (см. ``_persist_call_record``), а не своя таблица. Хранили бы отдельно —
    записи разъезжались бы с лентой чата.
    """
    items, total = await calls_crud.get_call_history(
        session, user_id=user.id, limit=limit, offset=offset
    )
    return CallHistoryResponse(
        items=[CallHistoryItem.model_validate(item) for item in items],
        total=total,
    )


@router.websocket("/calls")
async def websocket_calls(websocket: WebSocket) -> None:
    """Сигнальный канал звонков для текущего авторизованного пользователя."""
    user = await resolve_user_from_websocket(websocket)
    if user is None:
        return

    await call_manager.connect(user.id, websocket)
    # Канал вернулся (перезагрузка страницы, смена сети): снимаем запланированное
    # завершение звонка — «я снова здесь» (см. `_schedule_call_end`). Номера
    # вызова тут нет, поэтому отменяем всё, что ждали по этому человеку.
    _cancel_call_end("", user.id)
    try:
        while True:
            data = await websocket.receive_json()
            await _handle_message(user.id, data, websocket)
    except WebSocketDisconnect:
        logger.debug("Пользователь %s отключился от сигналинга", user.id)
    finally:
        await call_manager.disconnect(user.id, websocket)
        # Канал замолчал: если человек был в звонке, собеседники не должны
        # остаться «в разговоре» с тишиной. Подробности — в
        # `_schedule_call_ends_after_signal_loss`.
        _schedule_call_ends_after_signal_loss(user.id)
