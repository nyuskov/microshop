"""Уведомления о критичных действиях с аккаунтом.

Зачем: при угоне аккаунта у владельца нет другого сигнала, кроме письма. А без
уведомлений «пароль сменили — все устройства молча вылетели» выглядит как сбой,
а не как возможная кража: см. roadmap, P0-пункт 3.

События:
- ``password_changed`` — пароль задан/изменён (все прочие сессии отозваны);
- ``password_reset`` — пароль восстановлен по коду из письма;
- ``sessions_revoked`` — «выйти на всех устройствах»;
- ``email_changed`` — адрес аккаунта заменён (письмо уходит на СТАРЫЙ адрес:
  именно так владелец узнаёт о чужой смене адреса);
- ``new_device`` — вход с устройства, которого у аккаунта раньше не было.

Канал — e-mail (SMTP). Telegram для этого не годится: ``api.telegram.org``
недоступен ни с прод-сервера, ни из РФ-сетей (проверено), а SMS Aero без договора
отклоняет все SMS.

Кому пишем: только на **подтверждённый** адрес (``user.email_verified``). Чужой
или ошибочный адрес не должен получать письма со сведениями об аккаунте, поэтому
в приложении отдельно просим подтвердить e-mail (см. блок «Безопасность» в
профиле). Если подтверждённого адреса нет — уведомление пропускается, в лог
идёт запись для отладки.

Письма ставятся в очередь Celery (``tasks.notifications.send_email``), поэтому
HTTP-запрос не ждёт SMTP. Дополнительно ограничиваем число писем на пользователя
в сутки: даже при атаке перебором почтовый ящик не превратится в спам-канал.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core import mailer
from core.celery_app import get_task
from core.models import LoginDevice, User
from core.rate_limit import rate_limit_key, rate_limiter

from .device import device_info

logger = logging.getLogger(__name__)

# Заголовки писем по событиям (тема письма — это то, что видно в списке писем).
EVENT_SUBJECTS: dict[str, str] = {
    "password_changed": "Pismo: пароль изменён",
    "password_reset": "Pismo: доступ восстановлен по e-mail",
    "sessions_revoked": "Pismo: выполнен выход на всех устройствах",
    "email_changed": "Pismo: адрес e-mail в аккаунте изменён",
    "new_device": "Pismo: вход с нового устройства",
    "account_frozen": "Pismo: аккаунт заморожен",
    "account_unfrozen": "Pismo: аккаунт разморожен",
    "panic": "Pismo: сработала тревога «это были не я»",
    "e2ee_key_changed": "Pismo: ключ шифрования устройства изменён",
}

# События, о которых имеет смысл сообщать (остальное — ошибка в коде вызова).
KNOWN_EVENTS = frozenset(EVENT_SUBJECTS)

# Совет в конце письма: одинаков для всех событий, но только если вход выполнен
# не владельцем, он реально помогает.
_ADVICE = (
    "Если это были не вы — сразу смените пароль в приложении (Профиль → "
    "Безопасность), нажмите «Выйти на всех устройствах» и напишите на "
    "nyuskov@gmail.com."
)

_MAX_NOTIFICATIONS_PER_DAY = 20


def _now() -> str:
    """Дата и время события в читаемом виде (UTC, чтобы не зависеть от сервера)."""
    return datetime.now(timezone.utc).strftime("%d.%m.%Y %H:%M UTC")


def notification_recipient(user: User) -> str | None:
    """Адрес для уведомлений: подтверждённый e-mail аккаунта (иначе None)."""
    if user.email and user.email_verified:
        return str(user.email)
    return None


def enqueue_security_email(to: str, subject: str, body: str) -> None:
    """Ставит письмо в очередь Celery.

    Если SMTP не настроен (локальная разработка) — печатаем письмо в лог web,
    чтобы сценарий можно было проверить без почтового сервера.
    """
    if not mailer.is_configured():
        logger.info(
            "Почтовая заглушка (dev): уведомление для %s «%s»\n%s",
            mailer.mask_email(to),
            subject,
            body,
        )
    try:
        task = get_task("tasks.notifications.send_email")
        task.delay(subject, to, body)
    except Exception:  # noqa: BLE001 - брокер может быть недоступен (dev без docker)
        logger.warning(
            "RabbitMQ недоступен: уведомление для %s не поставлено в очередь",
            mailer.mask_email(to),
        )


async def _allowed_by_daily_cap(user_id: int) -> bool:
    """Не превышен ли суточный лимит писем пользователю."""
    return await rate_limiter.allow(
        rate_limit_key("notify:security-daily", str(user_id)),
        limit=_MAX_NOTIFICATIONS_PER_DAY,
        window_seconds=86400,
    )


def enqueue_security_push(
    user_id: int, *, title: str, body: str, panic_token: str | None = None
) -> None:
    """Ставит в очередь push о событии безопасности (Web Push и RuStore).

    Push — второй канал рядом с письмом, и он важен именно тем, что работает
    БЕЗ подтверждённого e-mail: раньше владелец без подтверждённой почты вообще
    не узнавал о чужом входе (ни письма, ни уведомления).

    ``panic_token`` добавляет в уведомление кнопку «Это не я» (см. ``panic.py``).
    """
    try:
        task = get_task("tasks.notifications.send_security_push")
        task.delay(user_id, title, body, panic_token)
    except Exception:  # noqa: BLE001 - брокер может быть недоступен (dev без docker)
        logger.warning(
            "RabbitMQ недоступен: push о безопасности для %s не поставлен в очередь",
            user_id,
        )


def _push_body(details: str, subject: str) -> str:
    """Короткий текст push: первая содержательная строка события, недлинно.

    В уведомлении на телефоне нет места для абзацев, но именно первая строка
    (устройство, IP, что случилось) и есть самое полезное.
    """
    for line in details.splitlines():
        text = line.strip()
        if text:
            return text if len(text) <= 160 else text[:157] + "…"
    return subject


async def notify_account_frozen(
    session: AsyncSession,
    *,
    user: User,
    request: Request | None = None,
    source: str = "self",
) -> None:
    """Сообщает владельцу о заморозке аккаунта (письмо + push).

    Заморозка — действие самого владельца (или поддержки), но именно оно чаще
    всего случается ПОСЛЕ чужого входа: важно, чтобы письмо с «это были не вы?»
    ушло сразу и на два канала.
    """
    where = "из приложения" if source == "self" else "поддержкой"
    await notify_security_event(
        session,
        user,
        event="account_frozen",
        request=request,
        details=(
            f"Аккаунт заморожен {where}: все устройства вышли, вход закрыт.\n"
            "Разморозить можно кодом из письма (Профиль → Безопасность или "
            "экран входа)."
        ),
    )


async def notify_account_unfrozen(
    session: AsyncSession, *, user: User, request: Request | None = None
) -> None:
    """Сообщает владельцу, что аккаунт снова активен (письмо + push).

    Это защита от незаметной разморозки: если владелец видит такое письмо, а сам
    ничего не делал — значит доступ восстановил кто-то другой.
    """
    await notify_security_event(
        session,
        user,
        event="account_unfrozen",
        request=request,
        details="Аккаунт снова активен. Если это были не вы — смените пароль.",
    )


async def notify_security_event(
    session: AsyncSession,
    user: User,
    *,
    event: str,
    request: Request | None = None,
    details: str = "",
    recipient: str | None = None,
    push: bool = True,
) -> bool:
    """Сообщает о критичном действии в аккаунте. ``True`` — письмо поставлено в очередь.

    Каналов два, и они дополняют друг друга:

    * письмо — подробности, адресовано только владельцу почты;
    * push — быстрый и, главное, работает БЕЗ подтверждённого e-mail: раньше
      владелец без подтверждённой почты вообще не узнавал о чужом входе.

    ``recipient`` нужен для смены e-mail: там письмо идёт на СТАРЫЙ адрес, а не
    на текущий адрес аккаунта. ``push=False`` — когда вызывающий сам отправляет
    отдельный push (например, с кнопкой «Это не я»).

    Ничего не роняем: если уведомление не ушло (нет SMTP, нет подтверждённого
    адреса, брокер лежит), действие пользователя всё равно уже выполнено — это
    уведомление, а не часть транзакции.
    """
    if event not in KNOWN_EVENTS:
        logger.warning("Неизвестное событие безопасности: %s", event)
        return False

    if not await _allowed_by_daily_cap(user.id):
        logger.warning(
            "Суточный лимит уведомлений исчерпан (пользователь %s): "
            "событие «%s» не отправлено",
            user.id,
            event,
        )
        return False

    to = recipient or notification_recipient(user)
    if not to:
        logger.info(
            "Письмо о событии «%s» (пользователь %s) пропущено: "
            "нет подтверждённого e-mail — отправляем только push",
            event,
            user.id,
        )
    else:
        lines = [
            EVENT_SUBJECTS[event],
            "",
            f"Время: {_now()}",
        ]
        if details:
            lines.append(details)
        lines.extend(
            ["", _ADVICE, "", "— Pismo, автоматическое уведомление о безопасности"]
        )

        enqueue_security_email(to, EVENT_SUBJECTS[event], "\n".join(lines))
        logger.info(
            "Уведомление «%s» поставлено в очередь для пользователя %s (%s)",
            event,
            user.id,
            mailer.mask_email(to),
        )

    if push:
        enqueue_security_push(
            user.id,
            title=EVENT_SUBJECTS[event],
            body=_push_body(details, EVENT_SUBJECTS[event]),
        )
    return bool(to)


async def remember_login_device(
    session: AsyncSession,
    user: User,
    request: Request | None,
    *,
    notify: bool = True,
) -> bool:
    """Запоминает устройство входа и (по желанию) уведомляет о новом.

    ``True`` — устройство новое для аккаунта. ``notify=False`` нужен там, где
    вход уже подтверждён кодом из письма: письмо «вход с нового устройства» было
    бы вторым письмом об одном и том же действии.

    Первое устройство аккаунта запоминаем молча: это регистрация (или первый
    вход после удаления истории), владелец и так знает, что он только что вошёл.
    """
    info = device_info(request)

    existing_count = await session.scalar(
        select(func.count())
        .select_from(LoginDevice)
        .where(LoginDevice.user_id == user.id)
    )
    known = await session.scalar(
        select(LoginDevice).where(
            LoginDevice.user_id == user.id,
            LoginDevice.signature == info.signature,
        )
    )
    if known is not None:
        known.last_ip = info.ip
        known.user_agent = info.user_agent
        known.last_seen_at = datetime.now(timezone.utc)
        await session.commit()
        return False

    session.add(
        LoginDevice(
            user_id=user.id,
            signature=info.signature,
            user_agent=info.user_agent,
            last_ip=info.ip,
        )
    )
    await session.commit()

    if not existing_count:
        logger.info("Первое устройство пользователя %s запомнено", user.id)
        return True

    if notify:
        await notify_security_event(
            session,
            user,
            event="new_device",
            request=request,
            details=(
                f"Устройство: {info.label}\n"
                f"IP-адрес: {info.ip or 'неизвестен'}\n"
                "Вход выполнен успешно."
            ),
            # Push здесь свой (с кнопкой «Это не я»), общий не нужен.
            push=False,
        )
        # Push с кнопкой «Это не я»: владелец может выкинуть вора одним тапом,
        # не заходя в приложение (и даже если e-mail у аккаунта не подтверждён).
        from .panic import build_panic_token

        enqueue_security_push(
            user.id,
            title="Новый вход в аккаунт",
            body=(
                f"{info.label} · {info.ip or 'IP неизвестен'}. "
                "Если это не вы — нажмите «Это не я»."
            ),
            panic_token=build_panic_token(user),
        )
    return True


def email_changed_message(old_email: str, new_email: str | None) -> str:
    """Текст уведомления о смене адреса (отдельно — чтобы не дублировать логику)."""
    target = new_email or "адрес удалён"
    return f"Прежний адрес: {old_email}\nНовый адрес: {target}"


__all__ = [
    "EVENT_SUBJECTS",
    "email_changed_message",
    "enqueue_security_email",
    "notification_recipient",
    "notify_security_event",
    "remember_login_device",
]
