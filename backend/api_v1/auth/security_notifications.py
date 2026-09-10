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

import hashlib
import logging
from datetime import datetime, timezone

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.rate_limit import client_ip, rate_limit_key, rate_limiter
from core import mailer
from core.celery_app import get_task
from core.models import LoginDevice, User

logger = logging.getLogger(__name__)

# Заголовки писем по событиям (тема письма — это то, что видно в списке писем).
EVENT_SUBJECTS: dict[str, str] = {
    "password_changed": "Pismo: пароль изменён",
    "password_reset": "Pismo: доступ восстановлен по e-mail",
    "sessions_revoked": "Pismo: выполнен выход на всех устройствах",
    "email_changed": "Pismo: адрес e-mail в аккаунте изменён",
    "new_device": "Pismo: вход с нового устройства",
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


def device_signature(request: Request | None) -> str:
    """Отпечаток устройства: sha256(User-Agent).

    Версию браузера не выбрасываем: обновление браузера даёт новый отпечаток и
    лишнее письмо, но пропустить чужой вход хуже, чем прислать лишнее письмо.
    """
    agent = ""
    if request is not None:
        agent = request.headers.get("user-agent", "")[:255]
    return hashlib.sha256(agent.encode("utf-8", "replace")).hexdigest()


def _agent_label(user_agent: str) -> str:
    """Человекочитаемое описание устройства для письма (или общая фраза)."""
    return user_agent.strip() or "неизвестное устройство"


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


async def notify_security_event(
    session: AsyncSession,
    user: User,
    *,
    event: str,
    request: Request | None = None,
    details: str = "",
    recipient: str | None = None,
) -> bool:
    """Отправляет письмо о критичном действии. ``True`` — письмо поставлено в очередь.

    ``recipient`` нужен для смены e-mail: там письмо идёт на СТАРЫЙ адрес, а не
    на текущий адрес аккаунта.

    Ничего не роняем: если письмо не ушло (нет SMTP, нет подтверждённого адреса,
    брокер лежит), действие пользователя всё равно уже выполнено — это
    уведомление, а не часть транзакции.
    """
    if event not in KNOWN_EVENTS:
        logger.warning("Неизвестное событие безопасности: %s", event)
        return False

    to = recipient or notification_recipient(user)
    if not to:
        logger.info(
            "Уведомление «%s» для пользователя %s пропущено: "
            "нет подтверждённого e-mail",
            event,
            user.id,
        )
        return False

    if not await _allowed_by_daily_cap(user.id):
        logger.warning(
            "Суточный лимит уведомлений исчерпан (пользователь %s): "
            "письмо «%s» не отправлено",
            user.id,
            event,
        )
        return False

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
    return True


async def remember_login_device(
    session: AsyncSession,
    user: User,
    request: Request | None,
) -> bool:
    """Запоминает устройство входа и уведомляет о новом. ``True`` — устройство новое.

    Первое устройство аккаунта запоминаем молча: это регистрация (или первый
    вход после удаления истории), владелец и так знает, что он только что вошёл.
    """
    signature = device_signature(request)
    agent = (request.headers.get("user-agent", "") if request is not None else "")[:255]
    ip = client_ip(request) if request is not None else ""

    existing_count = await session.scalar(
        select(func.count())
        .select_from(LoginDevice)
        .where(LoginDevice.user_id == user.id)
    )
    known = await session.scalar(
        select(LoginDevice).where(
            LoginDevice.user_id == user.id,
            LoginDevice.signature == signature,
        )
    )
    if known is not None:
        known.last_ip = ip
        known.user_agent = agent
        known.last_seen_at = datetime.now(timezone.utc)
        await session.commit()
        return False

    session.add(
        LoginDevice(
            user_id=user.id,
            signature=signature,
            user_agent=agent,
            last_ip=ip,
        )
    )
    await session.commit()

    if not existing_count:
        logger.info("Первое устройство пользователя %s запомнено", user.id)
        return True

    await notify_security_event(
        session,
        user,
        event="new_device",
        request=request,
        details=(
            f"Устройство: {_agent_label(agent)}\n"
            f"IP-адрес: {ip or 'неизвестен'}\n"
            "Вход выполнен успешно."
        ),
    )
    return True


def email_changed_message(old_email: str, new_email: str | None) -> str:
    """Текст уведомления о смене адреса (отдельно — чтобы не дублировать логику)."""
    target = new_email or "адрес удалён"
    return f"Прежний адрес: {old_email}\nНовый адрес: {target}"


__all__ = [
    "EVENT_SUBJECTS",
    "device_signature",
    "email_changed_message",
    "enqueue_security_email",
    "notification_recipient",
    "notify_security_event",
    "remember_login_device",
]
