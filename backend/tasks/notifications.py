"""Фоновые задачи: уведомления (e-mail, push) и публикация событий.

``send_email`` — транспорт служебных писем (уведомления о смене пароля,
входе с нового устройства и т.п.; текст формирует api_v1/security_notifications).
``send_message_push`` — push о новых сообщениях (Web Push + RuStore).
``send_story_reaction_push`` — push автору истории, которой поставили реакцию.
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
from core import avatar_store, mailer, rustore_push
from core.amqp import publish_realtime_event
from core.celery_app import celery_app
from core.config import settings
from core.i18n import locale_of_user, normalize_locale, t
from core.mentions import mentioned_logins
from core.models import Chat, Message, Profile, PushSubscription, RuStorePushToken, User
from core.quiet_hours import skips_push, utc_now
from tasks.base import make_engine, make_session, run_async

logger = logging.getLogger(__name__)

#: Тема push о звонке: уведомления одного вызова заменяют друг друга. Тот же
#: topic использует «звонок завершён» — если вызов закончился раньше, чем push
#: дошёл, человек не получит «Вам звонят» о прошедшем вызове.
PUSH_CALL_TOPIC = "pismo-call"
# RFC 8030: Urgency high будит устройство сразу; без него Android в Doze
# придерживает push до следующего окна — уведомление о звонке приходит поздно.
PUSH_HEADERS_CALL = {"Urgency": "high", "Topic": PUSH_CALL_TOPIC}
#: Повтор уведомления о звонке: тот же высокий приоритет, но БЕЗ `Topic`.
#: `Topic` — это склейка очереди: повторы с ним схлопнулись бы в один, и звук
#: прозвучал бы один раз — ровно то, ради чего повторы и делаются.
PUSH_HEADERS_CALL_REPEAT = {"Urgency": "high"}
PUSH_HEADERS_MESSAGE = {"Urgency": "high"}
# Звонок живёт меньше минуты смысла; сообщение — сутки.
PUSH_TTL_CALL = 90
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


#: Тело уведомления, когда человек скрыл текст сообщения в настройках: видно,
#: кто написал, но не что именно.
PUSH_HIDDEN_BODY = "Новое сообщение"


def _lang_of(profile: Profile | None) -> str:
    """Язык уведомления — язык ПОЛУЧАТЕЛЯ (а не того, кто написал)."""
    return normalize_locale(getattr(profile, "language", None))


def _message_push_actions(lang: str) -> list[dict[str, str]]:
    """Кнопки уведомления о сообщении — на языке получателя.

    Подписи нужны в payload, потому что service worker не знает профиль: он
    работает вне приложения и до его загрузки.
    """
    return [
        {"action": "reply", "title": t("Ответить", lang=lang)},
        {
            "action": "mark-read",
            "title": t("Пометить как прочитанное", lang=lang),
        },
    ]


def _body_for_user(body: str, profile: Profile | None) -> str:
    """Тело уведомления для получателя: без текста, если он его скрыл.

    Профиля нет (старый аккаунт) — считаем, что превью разрешено: вести себя
    иначе, чем до появления настройки, нельзя.
    """
    if profile is not None and not profile.notification_preview:
        return t(PUSH_HIDDEN_BODY, lang=_lang_of(profile))
    return body


async def _profiles_by_user(
    session: AsyncSession, user_ids: list[int]
) -> dict[int, Profile]:
    """Профили получателей (настройки уведомлений живут в них)."""
    if not user_ids:
        return {}
    stmt = select(Profile).where(Profile.user_id.in_(user_ids))
    return {
        profile.user_id: profile
        for profile in (await session.execute(stmt)).scalars().all()
    }


async def _awake_ids(
    session: AsyncSession, user_ids: list[int], *, is_call: bool
) -> list[int]:
    """Кого из получателей можно будить сейчас (без учёта тихих часов).

    Мьют чата и тихие часы — разные вещи: мьют убирает уведомления об одном
    чате навсегда, тихие часы — про время суток у конкретного человека. Поэтому
    мьют отсеивается раньше (там известно только про один чат), а здесь мы
    смотрим настройку получателя целиком.

    Уведомления безопасности эту проверку не проходят — там свой вызов push.
    """
    if not user_ids:
        return []
    profiles = await _profiles_by_user(session, user_ids)
    now = utc_now()
    return [
        user_id
        for user_id in user_ids
        if not skips_push(profiles.get(user_id), now, is_call=is_call)
    ]


def _mention_title(base: str, mentioned: bool, lang: str | None = None) -> str:
    """Заголовок уведомления: получателя упомянули — говорим прямо."""
    return t("{title}: вас упомянули", lang=lang, title=base) if mentioned else base


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


def _group_by_push(
    recipient_ids: list[int],
    titles: dict[int, str],
    bodies: dict[int, str],
    fallback_title: str,
    fallback_body: str,
) -> dict[tuple[str, str], list[int]]:
    """Группирует получателей по паре «заголовок + тело» уведомления.

    Личное имя контакта («Мама») и настройка «показывать текст сообщения» у
    каждого свои, поэтому один общий push на всех не годится: собираем группы
    с одинаковым текстом уведомления и шлём на каждую свою копию.
    """
    groups: dict[tuple[str, str], list[int]] = {}
    for user_id in recipient_ids:
        key = (
            titles.get(user_id, fallback_title),
            bodies.get(user_id, fallback_body),
        )
        groups.setdefault(key, []).append(user_id)
    return groups


def _rustore_message(
    *, title: str, body: str, channel_id: str, data: dict[str, object]
) -> dict[str, object]:
    """Собирает сообщение для Push API RuStore (формат, совместимый с FCM)."""
    return {
        "notification": {"title": title, "body": body},
        # `actions` — только для Web Push: у RuStore в data допустимы лишь плоские
        # строки (см. формат, совместимый с FCM), поэтому подписи кнопок туда не
        # кладём — там их рисует само приложение.
        "data": {
            key: str(value)
            for key, value in data.items()
            if value is not None and key != "actions"
        },
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

        # Тихие часы: ночью не будим сообщениями. Из очереди задача выходит
        # штатно — сообщение всё равно придёт в приложение, а непрочитанное
        # видно счётчиком. Звонки здесь не при чём (см. is_call ниже).
        profiles = await _profiles_by_user(session, recipient_ids)
        now = utc_now()
        recipient_ids = [
            user_id
            for user_id in recipient_ids
            if not skips_push(profiles.get(user_id), now, is_call=False)
        ]
        if not recipient_ids:
            return

        # «Как в Telegram»: если отправитель записан у получателя в контактах под
        # своим именем («Мама»), в уведомлении показываем именно его. Имя личное:
        # остальные видят обычное имя отправителя.
        titles = (
            await contact_names_for(session, owner_ids=recipient_ids, peer_id=sender_id)
            if sender is not None
            else {}
        )
        title = _display_name(sender) if sender else t("Новое сообщение")
        # Тексты уведомления — на языке КАЖДОГО получателя: один читает по-русски,
        # другой по-английски, и push каждому уходит свой (группы ниже).
        bodies: dict[int, str] = {}
        if message is None:
            bodies = {
                user_id: t("Новое сообщение", lang=_lang_of(profiles.get(user_id)))
                for user_id in recipient_ids
            }
        elif message.encrypted:
            # E2EE: на сервере лежит шифротекст — в уведомление текст не шлём.
            # Для вложений уточняем, что защищено именно вложение.
            key = (
                "🔒 Вложение защищено сквозным шифрованием"
                if message.file_url
                else "🔒 Сообщение защищено сквозным шифрованием"
            )
            bodies = {
                user_id: t(key, lang=_lang_of(profiles.get(user_id)))
                for user_id in recipient_ids
            }
        else:
            text = (message.text or "").strip()
            if text:
                # Текст человека не переводим: это его слова, а не интерфейс.
                short = text if len(text) <= 120 else text[:117] + "…"
                bodies = {user_id: short for user_id in recipient_ids}
            elif message.file_name:
                bodies = {
                    user_id: t(
                        "Вложение: {name}",
                        lang=_lang_of(profiles.get(user_id)),
                        name=message.file_name,
                    )
                    for user_id in recipient_ids
                }
            else:
                bodies = {user_id: "" for user_id in recipient_ids}

        # Кого упомянули в тексте: обращение к человеку помечаем в уведомлении
        # отдельно, чтобы его не потеряли среди остальных сообщений чата.
        mentioned_ids = await _mentioned_recipient_ids(session, recipient_ids, message)
        push_titles = {
            user_id: _mention_title(
                titles.get(user_id, title),
                user_id in mentioned_ids,
                lang=_lang_of(profiles.get(user_id)),
            )
            for user_id in recipient_ids
        }

        # Текст сообщения — только тем, кто его не скрыл в настройках: иначе
        # содержимое переписки читается с экрана блокировки и оседает в галерее
        # уведомлений. Имя отправителя остаётся — понятно, открывать ли чат.
        push_bodies = {
            user_id: _body_for_user(bodies.get(user_id, ""), profiles.get(user_id))
            for user_id in recipient_ids
        }

        # Заголовок и тело у каждого получателя могут быть свои (личное имя
        # контакта, настройка превью, язык), поэтому шлём группами.
        for (group_title, group_body), group_ids in _group_by_push(
            recipient_ids,
            push_titles,
            push_bodies,
            title,
            t("Новое сообщение"),
        ).items():
            await _send_rustore_push(
                session,
                group_ids,
                _rustore_message(
                    title=group_title,
                    body=group_body,
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
            # Заголовок и тело собираем на каждую подписку: у получателя может
            # быть своё личное имя отправителя («Мама») и своя настройка
            # «показывать текст сообщения» — см. titles и push_bodies выше.
            payload = json.dumps(
                {
                    "title": push_titles.get(sub.user_id, title),
                    "body": push_bodies.get(sub.user_id, t("Новое сообщение")),
                    # Крупная иконка — аватар отправителя (как в мессенджерах).
                    "icon": _push_icon(sender),
                    "badge": PUSH_BADGE,
                    "data": {
                        "type": "message",
                        "chat_id": chat_id,
                        "message_id": message_id,
                        "peer_id": sender_id,
                        "mention": sub.user_id in mentioned_ids,
                        # Подписи кнопок рисует service worker, а язык знает
                        # сервер — см. sw.js и core/i18n.py.
                        "actions": _message_push_actions(
                            _lang_of(profiles.get(sub.user_id))
                        ),
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

    Берём не аватар как есть, а «иконку уведомления» (`avatar_store.push_icon_url`):
    размер крупной картинки задаёт система, поэтому аватар заранее уменьшен и
    окружён прозрачными полями — иначе он занимает всю плитку уведомления и
    выглядит грубо. Файла может не быть (аватар загружен до появления иконок) —
    он делается из оригинала на месте, а если и это не вышло, отдаём прежний
    адрес: уведомление без картинки хуже, чем уведомление с крупной.

    Путь отдаём относительный (`/media/...`): service worker лежит на том же
    origin и сам разворачивает его в абсолютный (см. frontend/public/sw.js),
    поэтому знать публичный адрес приложения серверу не нужно. Ссылка на
    аватар не секрет — она и так видна в интерфейсе.
    """
    if user is None:
        return PUSH_ICON_DEFAULT
    avatar = (user.avatar_thumb_url or user.avatar_url or "").strip()
    if not avatar:
        return PUSH_ICON_DEFAULT
    icon = avatar_store.push_icon_url(user.avatar_url, user.avatar_thumb_url)
    return icon or avatar


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
        lang = await locale_of_user(session, user_id)
        data: dict[str, object] = {"type": "security"}
        if panic_token:
            data["panic_token"] = panic_token
            # Подпись кнопки рисует service worker: отдаём её переведённой.
            data["actions"] = [{"action": "panic", "title": t("Это не я", lang=lang)}]
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


#: Заголовок уведомления о напоминании: видно, что это не новое сообщение, а то,
#: о чём человек сам просил напомнить.
PUSH_REMINDER_TITLE = "Напоминание"
#: Текст сообщения в подсказке обрезаем так же, как в push о сообщениях.
PUSH_REMINDER_TEXT_LIMIT = 120


def reminder_chat_label(
    *,
    chat: Chat | None,
    user_id: int,
    contact_name: str | None = None,
    lang: str | None = None,
) -> str:
    """Название чата для уведомления о напоминании.

    Грабля, на которой легко ошибиться (и уже ошиблись живьём): у личных чатов
    ``Chat.name`` — техническое (`phone_81385ee1`), показывать его человеку
    нельзя. Поэтому у личных чатов берём имя собеседника (личное имя из контактов
    важнее), у групп и каналов — название, а «Сохранённые» называем словами.
    """
    if chat is None:
        return t("Чат", lang=lang)
    if chat.is_self:
        return t("Сохранённые сообщения", lang=lang)
    if chat.is_group or chat.is_channel:
        return (chat.name or "").strip() or t("Чат", lang=lang)
    peer = next((item for item in chat.users if item.id != user_id), None)
    if peer is None:
        return t("Чат", lang=lang)
    return contact_name or _display_name(peer)


def reminder_body(
    *,
    label: str,
    message: Message | None,
    preview: bool = True,
    lang: str | None = None,
) -> str:
    """Тело push о напоминании: в каком чате и о чём речь.

    Три случая, которые легко перепутать (и потому вынесены в чистую функцию):
    текст скрыт настройкой (тогда чат называем, а содержимого нет), E2EE-чат
    (на сервере шифротекст — в уведомление он не уходит) и удалённое сообщение
    (напоминание всё равно должно привести человека в чат).
    """
    if not preview:
        return t("Сообщение в чате «{label}»", lang=lang, label=label)
    if message is None:
        return t("Чат «{label}»", lang=lang, label=label)
    if message.encrypted:
        # E2EE: содержимое серверу неизвестно, поэтому говорим только о защите.
        key = (
            "🔒 Вложение защищено сквозным шифрованием"
            if message.file_url
            else "🔒 Сообщение защищено сквозным шифрованием"
        )
        what = t(key, lang=lang)
    else:
        text = (message.text or "").strip()
        if text:
            what = (
                text
                if len(text) <= PUSH_REMINDER_TEXT_LIMIT
                else text[: PUSH_REMINDER_TEXT_LIMIT - 3] + "…"
            )
        elif message.file_name:
            what = t("Вложение: {name}", lang=lang, name=message.file_name)
        else:
            what = ""
    if not what:
        return t("Чат «{label}»", lang=lang, label=label)
    return t("Чат «{label}»: {what}", lang=lang, label=label, what=what)


@celery_app.task(
    name="tasks.notifications.send_reminder_push",
    bind=True,
    max_retries=2,
    default_retry_delay=5,
    soft_time_limit=60,
)
def send_reminder_push(
    self,
    reminder_id: int,
    user_id: int,
    chat_id: int,
    message_id: int,
) -> None:
    """Push о напоминании о сообщении (Web Push + RuStore).

    Ставится задачей разбора очереди (``tasks.scheduled_tasks``), когда время
    напоминания наступило. Тихие часы здесь НЕ проверяем: это не уведомление
    собеседника, а просьба самого человека вернуться к сообщению — он сам выбрал
    время (то же правило, что у уведомлений безопасности).

    ``reminder_id`` нужен только для тега уведомления (каждое напоминание —
    своё), в тексте он не участвует.
    """
    if not _web_push_configured() and not rustore_push.is_configured():
        return
    run_async(_send_reminder_push_async(reminder_id, user_id, chat_id, message_id))


async def _send_reminder_push_async(
    reminder_id: int, user_id: int, chat_id: int, message_id: int
) -> None:
    # Импорт внутри функции: у воркера нет нужды держать модуль чатов на импорте.
    from api_v1.chats.crud import get_chat_with_users

    engine = make_engine()
    session = make_session(engine)
    try:
        chat = await get_chat_with_users(session, chat_id)
        message = await session.get(Message, message_id)
        profiles = await _profiles_by_user(session, [user_id])
        profile = profiles.get(user_id)

        # Название чата в теле уведомления — иначе по обрезанному тексту не
        # понять, куда идти (личное имя собеседника, если он записан контактом).
        peer = None
        if chat is not None and not (chat.is_group or chat.is_channel or chat.is_self):
            peer = next((item for item in chat.users if item.id != user_id), None)
        contact_names = (
            await contact_names_for(session, owner_ids=[user_id], peer_id=peer.id)
            if peer is not None
            else {}
        )
        lang = _lang_of(profile)
        label = reminder_chat_label(
            chat=chat,
            user_id=user_id,
            contact_name=contact_names.get(user_id),
            lang=lang,
        )

        # Текст берём из самого сообщения в момент срабатывания: его могли
        # отредактировать, а напоминание всё равно должно быть узнаваемым.
        # Настройка «скрывать текст в уведомлениях» соблюдается (см. reminder_body).
        body = reminder_body(
            label=label,
            message=message,
            preview=profile is None or profile.notification_preview,
            lang=lang,
        )

        data: dict[str, object] = {
            "type": "reminder",
            "reminder_id": reminder_id,
            "chat_id": chat_id,
            "message_id": message_id,
        }

        await _send_rustore_push(
            session,
            [user_id],
            _rustore_message(
                title=t(PUSH_REMINDER_TITLE, lang=lang),
                body=body,
                channel_id=PUSH_CHANNEL_MESSAGES,
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
                "title": t(PUSH_REMINDER_TITLE, lang=lang),
                "body": body,
                "icon": PUSH_ICON_DEFAULT,
                "badge": PUSH_BADGE,
                # Своё напоминание — своё уведомление: два напоминания об одном
                # чате не должны заменять друг друга (тег по id напоминания).
                "tag": f"reminder-{reminder_id}",
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


@celery_app.task(
    name="tasks.notifications.send_story_reaction_push",
    bind=True,
    max_retries=2,
    default_retry_delay=5,
    soft_time_limit=60,
)
def send_story_reaction_push(
    self, author_id: int, reactor_id: int, emoji: str, story_id: int
) -> None:
    """Push автору истории о новой реакции (Web Push + RuStore).

    Задачу ставит ``api_v1.stories.notify`` только когда реакция ПОЯВИЛАСЬ:
    снятие своей реакции — не новость для автора. Тихие часы уважаем: история
    живёт сутки, а счётчик реакции автор увидит в панели «Аудитория».
    """
    if not _web_push_configured() and not rustore_push.is_configured():
        return
    run_async(_send_story_reaction_push_async(author_id, reactor_id, emoji, story_id))


async def _send_story_reaction_push_async(
    author_id: int, reactor_id: int, emoji: str, story_id: int
) -> None:
    engine = make_engine()
    session = make_session(engine)
    try:
        if not await _awake_ids(session, [author_id], is_call=False):
            return

        reactor = await session.get(User, reactor_id)
        # Личное имя контакта важнее публичного: если автор записал человека как
        # «Мама», именно это имя и должно быть в уведомлении.
        names = await contact_names_for(
            session, owner_ids=[author_id], peer_id=reactor_id
        )
        title = names.get(author_id) or (
            _display_name(reactor) if reactor is not None else "Новая реакция"
        )
        body = f"{emoji} Реакция на вашу историю"
        data = {
            "type": "story_reaction",
            "story_id": story_id,
            "emoji": emoji,
            "peer_id": reactor_id,
        }

        await _send_rustore_push(
            session,
            [author_id],
            _rustore_message(
                title=title,
                body=body,
                channel_id=PUSH_CHANNEL_MESSAGES,
                data=data,
            ),
        )

        if not _web_push_configured():
            return
        stmt = select(PushSubscription).where(PushSubscription.user_id == author_id)
        subscriptions = list((await session.execute(stmt)).scalars().all())
        if not subscriptions:
            return
        payload = json.dumps(
            {
                "title": title,
                "body": body,
                "icon": _push_icon(reactor),
                "badge": PUSH_BADGE,
                # Уведомления об одной истории заменяют друг друга: колонка
                # «❤️ Реакция на вашу историю» из пяти строк не нужна.
                "tag": f"pismo-story-{story_id}",
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


@celery_app.task(
    name="tasks.notifications.send_call_cancelled_push",
    bind=True,
    max_retries=1,
    default_retry_delay=5,
    soft_time_limit=20,
)
def send_call_cancelled_push(
    self, user_id: int, call_id: str | None, reason: str = "cancelled"
) -> None:
    """Тихий push «звонок уже не звонит»: закрывает уведомление о вызове.

    Уведомление о входящем звонке показывается с `requireInteraction` — само оно
    с экрана не исчезает. Если звонок приняли на другом устройстве, отклонили
    или зовущий отменил вызов, у человека остаётся висеть «Вам звонят» о
    прошедшем звонке. Здесь уходит push без заголовка и текста: service worker по
    нему закрывает уведомления этого вызова и ничего не показывает
    (см. `public/sw.js`).

    RuStore Push (Android-приложение) не используем: уведомление там рисует SDK,
    и закрыть его из веб-слоя нельзя.
    """
    if not _web_push_configured():
        return
    run_async(_send_call_cancelled_async(user_id, call_id, reason))


async def _send_call_cancelled_async(
    user_id: int, call_id: str | None, reason: str = "cancelled"
) -> None:
    engine = make_engine()
    session = make_session(engine)
    try:
        stmt = select(PushSubscription).where(PushSubscription.user_id == user_id)
        subscriptions = list((await session.execute(stmt)).scalars().all())
        if not subscriptions:
            return
        payload = json.dumps(
            {
                "data": {
                    "type": "call-cancelled",
                    "call_id": call_id,
                    # Причина нужна приложению: «answered»/«declined» на другом
                    # устройстве или «cancelled» — зовущий снял вызов.
                    "reason": reason,
                }
            },
            ensure_ascii=False,
        )
        await _web_push_to_subscriptions(
            session, subscriptions, payload, PUSH_TTL_CALL, PUSH_HEADERS_CALL
        )
    finally:
        await session.close()
        await engine.dispose()


#: Заголовок ПОВТОРА: видно, что это тот же вызов звонит снова, а не новое.
PUSH_CALL_REPEAT_TITLE = "Всё ещё звонит"


def call_push_title(attempt: int, lang: str | None = None) -> str:
    """Заголовок уведомления о звонке: первый раз или повтор."""
    return (
        t("Входящий звонок", lang=lang)
        if attempt <= 1
        else t(PUSH_CALL_REPEAT_TITLE, lang=lang)
    )


def call_push_headers(attempt: int) -> dict[str, str]:
    """HTTP-заголовки push о звонке.

    Повтор идёт БЕЗ `Topic` (см. `PUSH_HEADERS_CALL_REPEAT`), а первый push и
    «звонок больше не звонит» — с ним, чтобы заменить не доставленное уведомление.
    """
    return PUSH_HEADERS_CALL if attempt <= 1 else PUSH_HEADERS_CALL_REPEAT


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
    attempt: int = 1,
    total: int = 1,
) -> None:
    """Push о входящем звонке (Web Push для PWA + RuStore Push для Android).

    Показывает системное уведомление «Вам звонят…»; тап открывает приложение,
    где «висящий» offer уже ждёт (см. ``calls.manager.park_offer``).

    ``expires_at`` (мс UTC) — момент, после которого звонок уже не актуален
    (зовущий отменил или абонент ответил): такое уведомление не отправляем, чтобы
    человек не получал «Вам звонят» о прошедшем звонке.

    ``attempt``/``total`` — дозвон серией: пока вызов «висит», уведомление
    повторяется (см. ``calls.views._enqueue_call_push_when_ringing``), а повтор с
    тем же ``tag`` и ``renotify`` снова подаёт звук и вибрацию — одно уведомление
    дало бы один короткий сигнал, который легко пропустить.
    """
    if not _web_push_configured() and not rustore_push.is_configured():
        return
    if _call_push_expired(expires_at):
        logger.info("Push о звонке %s устарел — не отправляем", call_id)
        return
    run_async(
        _send_call_push_async(
            user_id, call_id, caller_id, kind, expires_at, attempt, total
        )
    )


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
    attempt: int = 1,
    total: int = 1,
) -> None:
    engine = make_engine()
    session = make_session(engine)
    try:
        lang = await locale_of_user(session, user_id)
        caller = await session.get(User, caller_id)
        # Тихие часы: звонок пропускаем, только если человек сам запретил звонки
        # в это время (по умолчанию — разрешены, звонить можно и ночью).
        if not await _awake_ids(session, [user_id], is_call=True):
            logger.info(
                "Звонок %s: у получателя тихие часы, звонки запрещены — не будим",
                call_id,
            )
            return
        name = _display_name(caller) if caller else t("Пользователь", lang=lang)
        # Личное имя звонящего у получателя («Мама») — как в списке чатов.
        if caller is not None:
            custom = (
                await contact_names_for(session, owner_ids=[user_id], peer_id=caller_id)
            ).get(user_id)
            if custom:
                name = custom
        kind_label = (
            t("Видеозвонок", lang=lang)
            if kind == "video"
            else t("Аудиозвонок", lang=lang)
        )
        # Повтор называем словами: человек видит, что ТОТ ЖЕ вызов звонит снова.
        title = call_push_title(attempt, lang=lang)
        body = f"{name} · {kind_label}"

        await _send_rustore_push(
            session,
            [user_id],
            _rustore_message(
                title=title,
                body=body,
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
                    # Номер попытки: по нему видно, что это повтор, а не новый вызов.
                    "attempt": attempt,
                    "total": total,
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
                "title": title,
                "body": body,
                # У входящего звонка тоже показываем аватар звонящего.
                "icon": _push_icon(caller),
                "badge": PUSH_BADGE,
                "data": {
                    "type": "call",
                    "call_id": call_id,
                    "peer_id": caller_id,
                    "kind": kind,
                    "expires_at": expires_at,
                    "attempt": attempt,
                    "total": total,
                    # Подписи кнопок уведомления: их рисует service worker, но
                    # язык знает сервер — см. push_actions().
                    "actions": [{"action": "open", "title": t("Открыть", lang=lang)}],
                },
            },
            ensure_ascii=False,
        )
        headers = call_push_headers(attempt)
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
                    headers=headers,
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
