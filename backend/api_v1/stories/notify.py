"""Уведомление автора истории о новой реакции.

Реакция уже сохранена в БД, поэтому уведомление — вспомогательная обязанность:
если живой сокет или брокер недоступны, реакция не должна пропасть, и наружу
ошибка не отдаётся (только журнал).
"""

from __future__ import annotations

import logging

from api_v1.events.service import dispatch_realtime
from api_v1.users.crud import display_name
from core.celery_app import get_task
from core.models import Story, User

logger = logging.getLogger(__name__)

#: Имя задачи воркера, отправляющей push (see `tasks/notifications.py`).
REACTION_PUSH_TASK = "tasks.notifications.send_story_reaction_push"


async def notify_reaction(*, story: Story, reactor: User, emoji: str) -> None:
    """Сообщает автору о поставленной реакции.

    Два канала, как у сообщений: живым сокетам уходит событие ``story.reaction``
    (приложение обновляет счётчики и показывает подсказку, пока автор в сети), а
    закрытому приложению — push через задачу воркера.
    """
    if story.user_id == reactor.id:
        return
    payload = {
        "type": "story.reaction",
        "story_id": story.id,
        "emoji": emoji,
        "user_id": reactor.id,
        # Имя отдаём сразу: авторской панели негде взять его без ещё одного
        # запроса, а личное имя контакта («Мама») — деталь личных настроек,
        # поэтому push собирает его в воркере, где есть доступ к контактам.
        "name": display_name(reactor),
    }
    try:
        await dispatch_realtime([story.user_id], payload)
    except Exception:  # noqa: BLE001 - сокет не должен ронять саму реакцию
        logger.exception(
            "Не удалось отправить событие о реакции на историю %s", story.id
        )

    try:
        get_task(REACTION_PUSH_TASK).delay(story.user_id, reactor.id, emoji, story.id)
    except Exception:  # noqa: BLE001 - брокер может быть недоступен (dev без docker)
        logger.warning(
            "RabbitMQ недоступен: push о реакции на историю %s не поставлен", story.id
        )
