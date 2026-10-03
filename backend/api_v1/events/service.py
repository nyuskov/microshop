"""Сервис рассылки событий реального времени.

Функции вызываются из CRUD/views мессенджера ПОСЛЕ коммита изменений в БД
и оповещают участников чата, чтобы их клиент сделал выборочный refetch.
"""

import logging
from typing import Any

from sqlalchemy import distinct, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.amqp import publish_realtime_event
from core.config import settings
from core.models import ChatMute, User, user_chat_association_table

from .manager import events_manager

logger = logging.getLogger(__name__)


async def dispatch_realtime(recipient_ids: list[int], payload: dict[str, Any]) -> bool:
    """Раздаёт событие пользователям: своим сокетам и другим процессам web.

    Зачем мост: сокеты живут в конкретном процессе, и при нескольких процессах
    web событие, отправленное в одном, не нашло бы абонента, подключённого к
    другому (он «не получает сообщения», хотя на связи). Поэтому событие всегда
    идёт и в fanout моста — остальные процессы раздадут его своим сокетам.

    Дубли исключены меткой процесса: свой же событие из очереди отбрасывается
    (`core/amqp.RealtimeBridgeConsumer`). Возвращаем результат ЛОКАЛЬНОЙ доставки:
    нужен только для отладки и тестов.
    """
    delivered = await events_manager.broadcast(recipient_ids, payload)
    if not recipient_ids:
        return delivered
    try:
        await publish_realtime_event(payload, recipient_ids)
    except Exception:  # без моста событие дойдёт хотя бы своим
        logger.exception("Не удалось опубликовать событие в мост")
    return delivered


async def chat_member_ids(session: AsyncSession, chat_id: int) -> list[int]:
    """Возвращает id участников чата."""
    stmt = select(user_chat_association_table.c.user_id).where(
        user_chat_association_table.c.chat_id == chat_id
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def presence_peer_ids(session: AsyncSession, user_id: int) -> list[int]:
    """Возвращает id пользователей, у которых есть общий чат с ``user_id``."""
    me = user_chat_association_table.alias("me")
    peer = user_chat_association_table.alias("peer")
    stmt = (
        select(distinct(peer.c.user_id))
        .select_from(me)
        .join(peer, peer.c.chat_id == me.c.chat_id)
        .where(me.c.user_id == user_id, peer.c.user_id != user_id)
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def presence_snapshot(
    session: AsyncSession, user_id: int
) -> list[dict[str, Any]]:
    """Снимок присутствия собеседников: кто реально у экрана и когда был.

    Отправляется клиенту сразу после подключения. Без него только что
    перезагруженное приложение (и любой новый клиент) не знает фактических
    статусов и выводит «в сети» из времени последней активности — а это неверно.
    """
    peer_ids = await presence_peer_ids(session, user_id)
    if not peer_ids:
        return []
    stmt = select(User.id, User.last_seen, User.presence_hidden).where(
        User.id.in_(peer_ids)
    )
    result = await session.execute(stmt)
    return [
        {
            "user_id": row.id,
            "online": events_manager.is_present(row.id),
            "last_seen": (
                row.last_seen.isoformat() if row.last_seen is not None else None
            ),
        }
        for row in result.all()
        # Скрытое присутствие не отдаём вообще: ни времени, ни статуса «в сети».
        if not row.presence_hidden
    ]


async def notify_chat_read_elsewhere(user_id: int, chat_id: int) -> None:
    """Сообщает ДРУГИМ устройствам человека, что он прочитал этот чат.

    Событие ``chat.read`` уходит собеседнику (галочки у отправителя), а своим
    же сессиям ничего не приходило — из-за этого на телефоне значок
    непрочитанного висел, пока не перезагрузишь страницу, хотя чат уже прочитан
    на компьютере.
    """
    await dispatch_realtime([user_id], {"type": "chat.read-self", "chat_id": chat_id})


async def muted_user_ids(session: AsyncSession, chat_id: int) -> set[int]:
    """Возвращает id участников, замьютивших этот чат (им не шлём push)."""
    stmt = select(ChatMute.user_id).where(ChatMute.chat_id == chat_id)
    result = await session.execute(stmt)
    return set(result.scalars().all())


async def notify_chat(
    session: AsyncSession,
    *,
    chat_id: int,
    payload: dict[str, Any],
    exclude_user_id: int | None = None,
    push: bool = True,
) -> None:
    """Отправляет событие всем участникам чата, кроме ``exclude_user_id``.

    ``push=False`` — событие живым сокетам отдаём, а Web Push не шлём. Так
    делается для системных записей (например, «звонок завершён»): о звонке
    человек уже знает, а уведомление «Новое сообщение» после разговора только
    путает (это не текстовое сообщение).
    """
    members = await chat_member_ids(session, chat_id)
    recipients = [user_id for user_id in members if user_id != exclude_user_id]
    await dispatch_realtime(recipients, payload)
    if not push:
        return

    # Web Push: при новом сообщении уведомляем получателей, чьё приложение
    # закрыто (подписки PWA). Событие кладём в очередь Celery, чтобы не
    # блокировать HTTP-запрос сетью до push-сервиса. Тем, кто замьютил чат,
    # push не отправляем (realtime-событие для них остаётся).
    if payload.get("type") != "message.new":
        return
    muted = await muted_user_ids(session, chat_id)
    push_recipients = [user_id for user_id in recipients if user_id not in muted]
    _maybe_enqueue_message_push(push_recipients, chat_id, payload)


def _maybe_enqueue_message_push(
    recipients: list[int], chat_id: int, payload: dict[str, Any]
) -> None:
    """Ставит задачу отправки push, если пришло новое сообщение и push включён."""
    if payload.get("type") != "message.new":
        return
    if (
        not settings.web_push_vapid_public_key
        or not settings.web_push_vapid_private_key
    ):
        return
    message_id = payload.get("message_id")
    sender_id = payload.get("sender_id")
    if not recipients or message_id is None or sender_id is None:
        return
    try:
        from core.celery_app import get_task

        get_task("tasks.notifications.send_message_push").delay(
            recipients, chat_id, message_id, sender_id
        )
    except Exception:  # push не должен ронять отправку сообщения
        logger.exception("Не удалось поставить задачу push-уведомления")


async def notify_user(user_id: int, payload: dict[str, Any]) -> bool:
    """Отправляет событие одному пользователю (если он на связи)."""
    return await dispatch_realtime([user_id], payload)
