"""Фоновые задачи: уведомления (e-mail и каркас web-push).

Здесь пока только структурная основа: задача ``send_email`` — заглушка-хелпер
(в проде заменяется на вызов почтового/пуш-провайдера), а также хелпер
``enqueue_generic_notification`` — точка, из которой в будущем будут
отправляться уведомления пользователям (пуш, e-mail о непрочитанных и т.п.).

``publish_realtime_new_message`` — вспомогательная обязанность воркера: после
записи нового сообщения (например, GIF) опубликовать в мост, чтобы web раздал
событие в живые сокеты.
"""

import logging

from core.amqp import publish_realtime_event
from core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="tasks.notifications.send_email", max_retries=3)
def send_email(subject: str, recipient: str, html_body: str) -> None:
    """Отправляет e-mail уведомление (заглушка).

    TODO(prod): заменить на реального почтового провайдера (SMTP/SES/...).
    Сейчас только логирует, чтобы подтвердить прохождение задачи через воркер.
    """
    logger.info("Email-заглушка: to=%s subject=%r", recipient, subject)
    # Здесь будет реальная отправка; вложенный HTML уже сформирован вызывающим кодом.


async def publish_realtime_new_message(
    *,
    recipient_ids: list[int],
    chat_id: int,
    message_id: int,
    sender_id: int,
) -> None:
    """Публикует ``message.new`` в мост, чтобы web оповестил живые сокеты.

    Вызывается воркером после того, как он сам создал сообщение в БД (вне
    процесса web), где in-process ``events_manager`` недоступен.
    """
    await publish_realtime_event(
        {
            "type": "message.new",
            "chat_id": chat_id,
            "message_id": message_id,
            "sender_id": sender_id,
        },
        recipient_ids=recipient_ids,
    )
