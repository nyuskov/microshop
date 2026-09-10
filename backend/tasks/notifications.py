"""Фоновые задачи: уведомления (e-mail, push) и публикация событий.

``send_email`` — транспорт служебных писем (уведомления о смене пароля,
входе с нового устройства и т.п.; текст формирует api_v1/security_notifications).
``send_message_push`` — push о новых сообщениях (Web Push + RuStore).
``enqueue_generic_notification`` — точка для уведомлений о непрочитанных и
подобных сценариев.

``publish_realtime_new_message`` — вспомогательная обязанность воркера: после
записи нового сообщения (например, GIF) опубликовать в мост, чтобы web раздал
событие в живые сокеты.
"""

import asyncio
import json
import logging

from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select

from core import mailer, rustore_push
from core.amqp import publish_realtime_event
from core.celery_app import celery_app
from core.config import settings
from core.models import Message, PushSubscription, RuStorePushToken, User
from tasks.base import make_engine, make_session, run_async

logger = logging.getLogger(__name__)

# RFC 8030: Urgency high будит устройство сразу; без него Android в Doze
# придерживает push до следующего окна — уведомление о звонке приходит поздно.
PUSH_HEADERS_CALL = {"Urgency": "high", "Topic": "pismo-call"}
PUSH_HEADERS_MESSAGE = {"Urgency": "high"}
# Звонок живёт меньше минуты смысла; сообщение — сутки.
PUSH_TTL_CALL = 60
PUSH_TTL_MESSAGE = 86_400

# ID каналов уведомлений Android-приложения (совпадают с PushChannels.java в android/).
PUSH_CHANNEL_MESSAGES = "pismo_messages"
PUSH_CHANNEL_CALLS = "pismo_calls"
# Intent action для клика по уведомлению (android/app/src/main/AndroidManifest.xml).
PUSH_CLICK_ACTION = "space.pismo.app.PUSH"


def _web_push_configured() -> bool:
    """Настроен ли Web Push (VAPID-ключи PWA)."""
    return bool(
        settings.web_push_vapid_public_key and settings.web_push_vapid_private_key
    )


def _rustore_message(
    *, title: str, body: str, channel_id: str, data: dict[str, object]
) -> dict[str, object]:
    """Собирает сообщение для Push API RuStore (формат, совместимый с FCM)."""
    return {
        "notification": {"title": title, "body": body},
        "data": {key: str(value) for key, value in data.items() if value is not None},
        "android": {
            "ttl": settings.rustore_push_ttl,
            "notification": {
                "channel_id": channel_id,
                "click_action": PUSH_CLICK_ACTION,
                "click_action_type": 0,
            },
        },
    }


async def _send_rustore_push(
    session, user_ids: list[int], message: dict[str, object]
) -> None:
    """Шлёт push через RuStore всем токенам пользователей (если канал настроен).

    Устаревшие токены (приложение удалено) удаляем из БД.
    """
    if not rustore_push.is_configured() or not user_ids:
        return
    stmt = select(RuStorePushToken).where(RuStorePushToken.user_id.in_(user_ids))
    tokens = list((await session.execute(stmt)).scalars().all())
    if not tokens:
        return

    stale: list[str] = []
    for row in tokens:
        status = await asyncio.to_thread(rustore_push.send, row.token, message)
        if status == rustore_push.STATUS_INVALID_TOKEN:
            stale.append(row.token)
        elif status == rustore_push.STATUS_AUTH_ERROR:
            # Общая проблема с сервисным токеном — дальше слать нет смысла.
            logger.warning(
                "RuStore Push: проверьте RUSTORE_PUSH_SERVICE_TOKEN/PROJECT_ID"
            )
            break

    if stale:
        await session.execute(
            delete(RuStorePushToken).where(RuStorePushToken.token.in_(stale))
        )
        await session.commit()
        logger.info("Удалено устаревших RuStore push-токенов: %s", len(stale))


@celery_app.task(name="tasks.notifications.send_email", max_retries=3)
def send_email(subject: str, recipient: str, body: str) -> None:
    """Отправляет служебное письмо пользователю (уведомления о безопасности).

    Текст письма формирует вызывающая сторона (см.
    ``api_v1.auth.security_notifications``) — здесь только транспорт: SMTP, а
    если он не настроен (локальная разработка), текст уходит в лог воркера,
    как и остальные dev-заглушки доставки.
    """
    if mailer.is_configured():
        try:
            mailer.send_email(recipient, subject, body)
            logger.info("Письмо отправлено на %s", mailer.mask_email(recipient))
            return
        except mailer.MailerError as exc:
            logger.warning(
                "SMTP недоступен (%s) — письмо для %s не отправлено",
                exc,
                mailer.mask_email(recipient),
            )

    logger.info(
        "Почтовая заглушка (dev): уведомление для %s, тема %r\n%s",
        mailer.mask_email(recipient),
        subject,
        body,
    )


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
    """Отправляет push о новом сообщении получателям (Web Push + RuStore).

    Вызывается из ``api_v1.events.service.notify_chat`` при событии
    ``message.new``. PWA получает уведомление через push-сервис браузера
    (Web Push / RFC 8291, pywebpush), Android-приложение — через RuStore Push.
    Если push-сервис отвечает 404/410, подписка устарела — удаляем её.
    """
    if not _web_push_configured() and not rustore_push.is_configured():
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
            if message.encrypted:
                # E2EE: на сервере лежит шифротекст — в уведомление текст не шлём.
                body = "🔒 Сообщение защищено сквозным шифрованием"
            else:
                text = (message.text or "").strip()
                if text:
                    body = text if len(text) <= 120 else text[:117] + "…"
                elif message.file_name:
                    body = f"Вложение: {message.file_name}"

        await _send_rustore_push(
            session,
            recipient_ids,
            _rustore_message(
                title=title,
                body=body,
                channel_id=PUSH_CHANNEL_MESSAGES,
                data={
                    "type": "message",
                    "chat_id": chat_id,
                    "message_id": message_id,
                    "peer_id": sender_id,
                },
            ),
        )

        # Дальше — Web Push для PWA (если VAPID-ключи заданы).
        if not _web_push_configured():
            return

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
                "badge": "/icons/badge-96.png",
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
                    ttl=PUSH_TTL_MESSAGE,
                    headers=PUSH_HEADERS_MESSAGE,
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


@celery_app.task(
    name="tasks.notifications.send_call_push",
    bind=True,
    max_retries=1,
    default_retry_delay=5,
    soft_time_limit=30,
)
def send_call_push(
    self,
    user_id: int,
    call_id: str | None,
    caller_id: int,
    kind: str | None,
) -> None:
    """Push о входящем звонке (Web Push для PWA + RuStore Push для Android).

    Показывает системное уведомление «Вам звонят…»; тап открывает приложение,
    где «висящий» offer уже ждёт (см. ``calls.manager.park_offer``).
    """
    if not _web_push_configured() and not rustore_push.is_configured():
        return
    run_async(_send_call_push_async(user_id, call_id, caller_id, kind))


async def _send_call_push_async(
    user_id: int,
    call_id: str | None,
    caller_id: int,
    kind: str | None,
) -> None:
    engine = make_engine()
    session = make_session(engine)
    try:
        caller = await session.get(User, caller_id)
        name = _display_name(caller) if caller else "Пользователь"
        kind_label = "Видеозвонок" if kind == "video" else "Аудиозвонок"

        await _send_rustore_push(
            session,
            [user_id],
            _rustore_message(
                title="Входящий звонок",
                body=f"{name} · {kind_label}",
                channel_id=PUSH_CHANNEL_CALLS,
                data={
                    "type": "call",
                    "call_id": call_id,
                    "peer_id": caller_id,
                    "kind": kind,
                },
            ),
        )

        # Дальше — Web Push для PWA (если VAPID-ключи заданы).
        if not _web_push_configured():
            return

        stmt = select(PushSubscription).where(PushSubscription.user_id == user_id)
        subscriptions = list((await session.execute(stmt)).scalars().all())
        if not subscriptions:
            return

        stale_ids: list[int] = []
        payload = json.dumps(
            {
                "title": "Входящий звонок",
                "body": f"{name} · {kind_label}",
                "icon": "/icons/icon-192.png",
                "badge": "/icons/badge-96.png",
                "data": {
                    "type": "call",
                    "call_id": call_id,
                    "peer_id": caller_id,
                    "kind": kind,
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
                    ttl=PUSH_TTL_CALL,
                    headers=PUSH_HEADERS_CALL,
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
                        "call-push не доставлен (endpoint …%s): %s",
                        sub.endpoint[-24:],
                        exc,
                    )
            except Exception as exc:  # noqa: BLE001 - сеть/таймауты не роняют задачу
                logger.warning(
                    "call-push error (endpoint …%s): %s",
                    sub.endpoint[-24:],
                    exc,
                )

        if stale_ids:
            await session.execute(
                delete(PushSubscription).where(PushSubscription.id.in_(stale_ids))
            )
            await session.commit()
            logger.info("Удалено устаревших push-подписок: %s", len(stale_ids))
    finally:
        await session.close()
        await engine.dispose()
