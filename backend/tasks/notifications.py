"""Фоновые задачи: уведомления (e-mail и каркас web-push).

Здесь пока только структурная основа: задача ``send_email`` — заглушка-хелпер
(в проде заменяется на вызов почтового/пуш-провайдера), а также хелпер
``enqueue_generic_notification`` — точка, из которой в будущем будут
отправляться уведомления пользователям (пуш, e-mail о непрочитанных и т.п.).

``publish_realtime_new_message`` — вспомогательная обязанность воркера: после
записи нового сообщения (например, GIF) опубликовать в мост, чтобы web раздал
событие в живые сокеты.
"""

import json
import logging

from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select

from core.amqp import publish_realtime_event
from core.celery_app import celery_app
from core.config import settings
from core.models import Message, PushSubscription, User
from tasks.base import make_engine, make_session, run_async

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


@celery_app.task(
    name="tasks.notifications.send_message_push",
    bind=True,
    max_retries=2,
    default_retry_delay=5,
    soft_time_limit=60,
)
def send_message_push(
    self,
    recipient_ids: list[int],
    chat_id: int,
    message_id: int,
    sender_id: int,
) -> None:
    """Отправляет Web Push о новом сообщении получателям (PWA).

    Вызывается из ``api_v1.events.service.notify_chat`` при событии
    ``message.new``. Доставка — через стандартный push-сервис браузера
    (Web Push / RFC 8291, pywebpush). Если push-сервис отвечает 404/410 —
    подписка устарела, удаляем её.
    """
    if (
        not settings.web_push_vapid_public_key
        or not settings.web_push_vapid_private_key
    ):
        return
    run_async(_send_message_push_async(recipient_ids, chat_id, message_id, sender_id))


async def _send_message_push_async(
    recipient_ids: list[int],
    chat_id: int,
    message_id: int,
    sender_id: int,
) -> None:
    engine = make_engine()
    session = make_session(engine)
    try:
        sender = await session.get(User, sender_id)
        message = await session.get(Message, message_id)

        title = _display_name(sender) if sender else "Новое сообщение"
        body = "Новое сообщение"
        if message is not None:
            text = (message.text or "").strip()
            if text:
                body = text if len(text) <= 120 else text[:117] + "…"
            elif message.file_name:
                body = f"Вложение: {message.file_name}"

        stmt = select(PushSubscription).where(
            PushSubscription.user_id.in_(recipient_ids)
        )
        subscriptions = list((await session.execute(stmt)).scalars().all())
        if not subscriptions:
            return

        stale_ids: list[int] = []
        payload = json.dumps(
            {
                "title": title,
                "body": body,
                "icon": "/icons/icon-192.png",
                "badge": "/icons/icon-192.png",
                "data": {
                    "type": "message",
                    "chat_id": chat_id,
                    "message_id": message_id,
                    "peer_id": sender_id,
                },
            },
            ensure_ascii=False,
        )
        for sub in subscriptions:
            try:
                webpush(
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                    },
                    data=payload,
                    vapid_private_key=settings.web_push_vapid_private_key,
                    vapid_claims={"sub": settings.web_push_vapid_subject},
                    timeout=10,
                )
            except WebPushException as exc:
                status_code = getattr(
                    getattr(exc, "response", None), "status_code", None
                )
                if status_code in (404, 410):
                    stale_ids.append(sub.id)
                else:
                    logger.warning(
                        "push не доставлен (endpoint …%s): %s",
                        sub.endpoint[-24:],
                        exc,
                    )
            except Exception as exc:  # noqa: BLE001 - сеть/таймауты не роняют задачу
                logger.warning("push error (endpoint …%s): %s", sub.endpoint[-24:], exc)

        if stale_ids:
            await session.execute(
                delete(PushSubscription).where(PushSubscription.id.in_(stale_ids))
            )
            await session.commit()
            logger.info("Удалено устаревших push-подписок: %s", len(stale_ids))
    finally:
        await session.close()
        await engine.dispose()


def _display_name(user: User) -> str:
    """Отображаемое имя пользователя."""
    if user.first_name and user.last_name:
        return f"{user.first_name} {user.last_name}"
    if user.first_name:
        return user.first_name
    if user.last_name:
        return user.last_name
    return user.username
