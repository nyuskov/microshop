"""Сервис рассылки событий реального времени.

Функции вызываются из CRUD/views мессенджера ПОСЛЕ коммита изменений в БД
и оповещают участников чата, чтобы их клиент сделал выборочный refetch.
"""

import logging
from typing import Any

from sqlalchemy import distinct, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.models import user_chat_association_table

from .manager import events_manager

logger = logging.getLogger(__name__)


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


async def notify_chat(
    session: AsyncSession,
    *,
    chat_id: int,
    payload: dict[str, Any],
    exclude_user_id: int | None = None,
) -> None:
    """Отправляет событие всем участникам чата, кроме ``exclude_user_id``."""
    members = await chat_member_ids(session, chat_id)
    recipients = [user_id for user_id in members if user_id != exclude_user_id]
    await events_manager.broadcast(recipients, payload)

    # Web Push: при новом сообщении уведомляем получателей, чьё приложение
    # закрыто (подписки PWA). Событие кладём в очередь Celery, чтобы не
    # блокировать HTTP-запрос сетью до push-сервиса.
    _maybe_enqueue_message_push(recipients, chat_id, payload)


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
    except Exception:  # noqa: BLE001 - push не должен ронять отправку сообщения
        logger.exception("Не удалось поставить задачу push-уведомления")


async def notify_user(user_id: int, payload: dict[str, Any]) -> bool:
    """Отправляет событие одному пользователю (если он на связи)."""
    return await events_manager.send_to_user(user_id, payload)
