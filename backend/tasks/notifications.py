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
import time

from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.contacts.crud import contact_names_for
from core import mailer, rustore_push
from core.amqp import publish_realtime_event
from core.celery_app import celery_app
from core.config import settings
from core.mentions import mentioned_logins
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
# События безопасности (новый вход, заморозка): отдельный канал, чтобы владелец
# мог оставить его включённым даже при отключённых уведомлениях о сообщениях.
PUSH_CHANNEL_SECURITY = "pismo_security"
# Intent action для клика по уведомлению (android/app/src/main/AndroidManifest.xml).
PUSH_CLICK_ACTION = "space.pismo.app.PUSH"

# Иконка уведомления по умолчанию. Если у отправителя есть аватар, вместо неё
# показываем аватар (см. _push_icon) — так видно, от кого сообщение.
PUSH_ICON_DEFAULT = "/icons/icon-192.png"
# Маленькая монохромная иконка (строка состояния Android) — всегда своя.
PUSH_BADGE = "/icons/badge-96.png"


def _web_push_configured() -> bool:
    """Настроен ли Web Push (VAPID-ключи PWA)."""
    return bool(
        settings.web_push_vapid_public_key and settings.web_push_vapid_private_key
    )


def _mention_title(base: str, mentioned: bool) -> str:
    """Заголовок уведомления: получателя упомянули — говорим прямо."""
    return f"{base}: вас упомянули" if mentioned else base


async def _mentioned_recipient_ids(
    session: AsyncSession, recipient_ids: list[int], message: Message | None
) -> set[int]:
    """Кто из получателей упомянут в тексте сообщения.

    Зашифрованный текст сервер прочитать не может — там упоминаний не ищем
    (получатель всё равно увидит текст в приложении).
    """
    if message is None or message.encrypted:
        return set()
    logins = mentioned_logins(message.text)
    if not logins:
        return set()
    stmt = select(User.id, User.username).where(User.id.in_(recipient_ids))
    rows = (await session.execute(stmt)).all()
    return {
        user_id for user_id, username in rows if username and username.lower() in logins
    }


def _group_by_title(
    recipient_ids: list[int], titles: dict[int, str], fallback: str
) -> dict[str, list[int]]:
    """Группирует получателей по заголовку уведомления.

    Личное имя контакта («Мама») у каждого получателя своё, поэтому один общий
    push на всех уже не годится: собираем группы с одинаковым заголовком и шлём
    на каждую свою копию уведомления.
    """
    groups: dict[str, list[int]] = {}
    for user_id in recipient_ids:
        groups.setdefault(titles.get(user_id, fallback), []).append(user_id)
    return groups


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

        # «Как в Telegram»: если отправитель записан у получателя в контактах под
        # своим именем («Мама»), в уведомлении показываем именно его. Имя личное:
        # остальные видят обычное имя отправителя.
        titles = (
            await contact_names_for(session, owner_ids=recipient_ids, peer_id=sender_id)
            if sender is not None
            else {}
        )
        title = _display_name(sender) if sender else "Новое сообщение"
        body = "Новое сообщение"
        if message is not None:
            if message.encrypted:
                # E2EE: на сервере лежит шифротекст — в уведомление текст не шлём.
                # Для вложений уточняем, что защищено именно вложение.
                body = (
                    "🔒 Вложение защищено сквозным шифрованием"
                    if message.file_url
                    else "🔒 Сообщение защищено сквозным шифрованием"
                )
            else:
                text = (message.text or "").strip()
                if text:
                    body = text if len(text) <= 120 else text[:117] + "…"
                elif message.file_name:
                    body = f"Вложение: {message.file_name}"

        # Кого упомянули в тексте: обращение к человеку помечаем в уведомлении
        # отдельно, чтобы его не потеряли среди остальных сообщений чата.
        mentioned_ids = await _mentioned_recipient_ids(session, recipient_ids, message)
        push_titles = {
            user_id: _mention_title(
                titles.get(user_id, title), user_id in mentioned_ids
            )
            for user_id in recipient_ids
        }

        # Заголовок у каждого получателя может быть свой (личное имя контакта),
        # поэтому шлём группами по одинаковому заголовку.
        for group_title, group_ids in _group_by_title(
            recipient_ids, push_titles, title
        ).items():
            await _send_rustore_push(
                session,
                group_ids,
                _rustore_message(
                    title=group_title,
                    body=body,
                    channel_id=PUSH_CHANNEL_MESSAGES,
                    data={
                        "type": "message",
                        "chat_id": chat_id,
                        "message_id": message_id,
                        "peer_id": sender_id,
                        # Аватар отправителя — приложение может показать его
                        # крупной иконкой (картинку по URL тянет уже устройство).
                        # Берём миниатюру: она в десятки раз меньше оригинала.
                        "peer_avatar": (
                            (sender.avatar_thumb_url or sender.avatar_url)
                            if sender
                            else None
                        ),
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
        for sub in subscriptions:
            # Заголовок собираем на каждую подписку: у получателя может быть своё
            # личное имя отправителя («Мама») — см. titles выше.
            payload = json.dumps(
                {
                    "title": push_titles.get(sub.user_id, title),
                    "body": body,
                    # Крупная иконка — аватар отправителя (как в мессенджерах).
                    "icon": _push_icon(sender),
                    "badge": PUSH_BADGE,
                    "data": {
                        "type": "message",
                        "chat_id": chat_id,
                        "message_id": message_id,
                        "peer_id": sender_id,
                        "mention": sub.user_id in mentioned_ids,
                    },
                },
                ensure_ascii=False,
            )
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


def _push_icon(user: User | None) -> str:
    """Иконка уведомления: аватар отправителя, иначе иконка приложения.

    Путь отдаём относительный (`/media/...`): service worker лежит на том же
    origin и сам разворачивает его в абсолютный (см. frontend/public/sw.js),
    поэтому знать публичный адрес приложения серверу не нужно. Ссылка на
    аватар не секрет — она и так видна в интерфейсе.
    """
    avatar = (user.avatar_thumb_url or user.avatar_url or "").strip() if user else ""
    return avatar or PUSH_ICON_DEFAULT


@celery_app.task(name="tasks.notifications.send_security_push")
def send_security_push(
    user_id: int, title: str, body: str, panic_token: str | None = None
) -> None:
    """Push о событии безопасности: новый вход, заморозка, тревога.

    Отдельно от push о сообщениях и работает даже без подтверждённого e-mail:
    раньше владелец без почты вообще не узнавал о чужом входе. Если передан
    ``panic_token``, в уведомлении появляется кнопка «Это не я» — по ней
    приложение завершает все сессии одним запросом (см. ``api_v1/auth/panic.py``).
    """
    run_async(_send_security_push_async(user_id, title, body, panic_token))


async def _send_security_push_async(
    user_id: int, title: str, body: str, panic_token: str | None = None
) -> None:
    engine = make_engine()
    session = make_session(engine)
    try:
        data: dict[str, object] = {"type": "security"}
        if panic_token:
            data["panic_token"] = panic_token
        await _send_rustore_push(
            session,
            [user_id],
            _rustore_message(
                title=title,
                body=body,
                channel_id=PUSH_CHANNEL_SECURITY,
                data=data,
            ),
        )

        if not _web_push_configured():
            return
        stmt = select(PushSubscription).where(PushSubscription.user_id == user_id)
        subscriptions = list((await session.execute(stmt)).scalars().all())
        if not subscriptions:
            return
        payload = json.dumps(
            {
                "title": title,
                "body": body,
                "icon": PUSH_ICON_DEFAULT,
                "badge": PUSH_BADGE,
                # Уведомления безопасности заменяют друг друга, а не копятся.
                "tag": "pismo-security",
                "data": data,
            },
            ensure_ascii=False,
        )
        await _web_push_to_subscriptions(
            session, subscriptions, payload, PUSH_TTL_MESSAGE, PUSH_HEADERS_MESSAGE
        )
    finally:
        await session.close()
        await engine.dispose()


async def _web_push_to_subscriptions(
    session,
    subscriptions: list[PushSubscription],
    payload: str,
    ttl: int,
    headers: dict[str, str],
) -> None:
    """Рассылает готовый payload по подпискам, убирая устаревшие (404/410)."""
    stale_ids: list[int] = []
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
                ttl=ttl,
                headers=headers,
                timeout=10,
            )
        except WebPushException as exc:
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            if status_code in (404, 410):
                stale_ids.append(sub.id)
            else:
                logger.warning(
                    "push не доставлен (endpoint …%s): %s", sub.endpoint[-24:], exc
                )
        except Exception as exc:  # noqa: BLE001 - сеть/таймауты не роняют задачу
            logger.warning("push error (endpoint …%s): %s", sub.endpoint[-24:], exc)

    if stale_ids:
        await session.execute(
            delete(PushSubscription).where(PushSubscription.id.in_(stale_ids))
        )
        await session.commit()
        logger.info("Удалено устаревших push-подписок: %s", len(stale_ids))


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
    expires_at: int | None = None,
) -> None:
    """Push о входящем звонке (Web Push для PWA + RuStore Push для Android).

    Показывает системное уведомление «Вам звонят…»; тап открывает приложение,
    где «висящий» offer уже ждёт (см. ``calls.manager.park_offer``).

    ``expires_at`` (мс UTC) — момент, после которого звонок уже не актуален
    (зовущий отменил или абонент ответил): такое уведомление не отправляем, чтобы
    человек не получал «Вам звонят» о прошедшем звонке.
    """
    if not _web_push_configured() and not rustore_push.is_configured():
        return
    if _call_push_expired(expires_at):
        logger.info("Push о звонке %s устарел — не отправляем", call_id)
        return
    run_async(_send_call_push_async(user_id, call_id, caller_id, kind, expires_at))


def _call_push_expired(expires_at: int | None) -> bool:
    """Просрочен ли push о звонке (мс UTC; None — срок не задан)."""
    if not expires_at:
        return False
    return time.time() * 1000 > expires_at


async def _send_call_push_async(
    user_id: int,
    call_id: str | None,
    caller_id: int,
    kind: str | None,
    expires_at: int | None = None,
) -> None:
    engine = make_engine()
    session = make_session(engine)
    try:
        caller = await session.get(User, caller_id)
        name = _display_name(caller) if caller else "Пользователь"
        # Личное имя звонящего у получателя («Мама») — как в списке чатов.
        if caller is not None:
            custom = (
                await contact_names_for(session, owner_ids=[user_id], peer_id=caller_id)
            ).get(user_id)
            if custom:
                name = custom
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
                    "peer_avatar": caller.avatar_url if caller else None,
                    # Срок годности: устройство могло получить push поздно
                    # (Doze) — тогда показывать «Вам звонят» уже незачем.
                    "expires_at": expires_at,
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
                # У входящего звонка тоже показываем аватар звонящего.
                "icon": _push_icon(caller),
                "badge": PUSH_BADGE,
                "data": {
                    "type": "call",
                    "call_id": call_id,
                    "peer_id": caller_id,
                    "kind": kind,
                    "expires_at": expires_at,
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
