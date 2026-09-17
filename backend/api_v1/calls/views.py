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
            if from_user_id in _group_calls.get(str(data.get("call_id") or ""), set()):
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
#: Сколько push о звонке остаётся актуальным.
#:
#: Зовущий ждёт ответа 60 секунд (``RING_OUT_TIMEOUT_MS`` на клиенте), и
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
    try:
        while True:
            data = await websocket.receive_json()
            await _handle_message(user.id, data, websocket)
    except WebSocketDisconnect:
        logger.debug("Пользователь %s отключился от сигналинга", user.id)
    finally:
        await call_manager.disconnect(user.id, websocket)
