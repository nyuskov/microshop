"""Решение модерации: авто-скрытие по жалобам, журнал и уведомления.

Политика (выбор владельца проекта):

- **3 жалобы от разных пользователей** на одно сообщение → сообщение скрывается
  автоматически, автору уходит письмо. Считаем именно разных заявителей: иначе один
  недоброжелатель мог бы скрыть чужой контент тремя жалобами.
- Скрытое сообщение видят все, **кроме автора** — он получает пометку «скрыто до
  проверки» и может отредактировать/удалить.
- Модератор в экране «Жалобы» подтверждает нарушение (``resolved``) или отклоняет
  (``rejected``). Подтверждение оставляет сообщение скрытым, отклонение —
  восстанавливает (если скрытие было автоматическим).
- Заявителю уходит письмо с решением; каждое действие (включая действия автомата)
  пишется в журнал ``moderation_actions``.

Журнал и счётчики — требование магазинов к приложениям с UGC: нужно доказать, что
жалобы разбираются, а контент скрывается по правилам, а не «по настроению».
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth import security_notifications
from core.config import settings
from core.i18n import locale_of_user, t
from core.models import Message, ModerationAction, User, UserReport
from core.models.moderation_action import (
    ACTION_MESSAGE_AUTO_HIDDEN,
    ACTION_MESSAGE_HIDDEN,
    ACTION_MESSAGE_RESTORED,
    ACTION_REPORT_STATUS_CHANGED,
)

logger = logging.getLogger(__name__)

# Тексты причин — в письме и в журнале лучше человеческий текст, а не код.
REASON_TITLES: dict[str, str] = {
    "spam": "спам или реклама",
    "abuse": "оскорбления или угрозы",
    "fraud": "мошенничество",
    "violence": "насилие или шок-контент",
    "other": "другое нарушение",
}

STATUS_TITLES: dict[str, str] = {
    "new": "новая",
    "in_review": "в работе",
    "resolved": "нарушение подтверждено",
    "rejected": "нарушение не подтверждено",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _moderation_message(
    report: UserReport, extra: str = "", lang: str | None = None
) -> str:
    """Текст письма заявителю (что произошло с его жалобой)."""
    reason = REASON_TITLES.get(report.reason, report.reason)
    lines = [
        t("Ваша жалоба в Pismo рассмотрена.", lang=lang),
        "",
        t(
            "Причина обращения: {reason}",
            lang=lang,
            reason=t(reason, lang=lang),
        ),
        t(
            "Решение: {status}",
            lang=lang,
            status=t(STATUS_TITLES.get(report.status, report.status), lang=lang),
        ),
    ]
    if report.note:
        lines.append(t("Комментарий модератора: {note}", lang=lang, note=report.note))
    if extra:
        lines.extend(["", extra])
    lines.extend(
        [
            "",
            t("Спасибо, что помогаете делать Pismo безопаснее.", lang=lang),
            t("— Pismo, уведомление модерации", lang=lang),
        ]
    )
    return "\n".join(lines)


def _author_message(message: Message, reports: int, lang: str | None = None) -> str:
    """Текст письма автору скрытого сообщения."""
    preview = (message.text or "").strip()
    if not preview:
        preview = message.file_name or t("вложение", lang=lang)
    if len(preview) > 120:
        preview = preview[:120] + "…"
    return "\n".join(
        [
            t("Ваше сообщение скрыто до проверки модератором.", lang=lang),
            "",
            t("Сообщение: «{preview}»", lang=lang, preview=preview),
            t(
                "Жалоб от разных пользователей: {reports}",
                lang=lang,
                reports=reports,
            ),
            "",
            t(
                "Скрытое сообщение видите только вы. Если это ошибка — напишите на",
                lang=lang,
            ),
            t("nyuskov@gmail.com или отредактируйте сообщение.", lang=lang),
            "",
            t("— Pismo, уведомление модерации", lang=lang),
        ]
    )


async def log_action(
    session: AsyncSession,
    *,
    action: str,
    moderator_id: int | None = None,
    target_user_id: int | None = None,
    report_id: int | None = None,
    message_id: int | None = None,
    note: str = "",
) -> None:
    """Записывает действие в журнал модерации (append-only)."""
    session.add(
        ModerationAction(
            action=action,
            moderator_id=moderator_id,
            target_user_id=target_user_id,
            report_id=report_id,
            message_id=message_id,
            note=note[:2000],
        )
    )
    await session.commit()


async def distinct_reporters(session: AsyncSession, *, message_id: int) -> list[int]:
    """ID разных пользователей, пожаловавшихся на сообщение."""
    rows = await session.execute(
        select(UserReport.reporter_id)
        .where(UserReport.message_id == message_id)
        .distinct()
    )
    return [int(value) for value in rows.scalars().all()]


async def maybe_auto_hide(
    session: AsyncSession, *, message_id: int | None, reported_id: int
) -> Message | None:
    """Скрывает сообщение, если жалоб от разных людей стало достаточно.

    Возвращает сообщение, если оно было скрыто именно сейчас (для письма автору),
    иначе ``None``.
    """
    threshold = settings.moderation_auto_hide_reports
    if message_id is None or threshold <= 0:
        return None

    message = await session.get(Message, message_id)
    if message is None or message.hidden_at is not None:
        return None

    reporters = await distinct_reporters(session, message_id=message_id)
    if len(reporters) < threshold:
        return None

    message.hidden_at = _now()
    message.hidden_reason = (
        f"жалобы от {len(reporters)} пользователей до проверки модератором"
    )
    await session.commit()

    await log_action(
        session,
        action=ACTION_MESSAGE_AUTO_HIDDEN,
        target_user_id=message.user_id,
        message_id=message.id,
        note=(
            f"Авто-скрытие: {len(reporters)} жалоб от разных пользователей "
            f"(порог {threshold})"
        ),
    )

    author = await session.get(User, message.user_id)
    if author is not None and author.email:
        # Автору пишем на его адрес даже без подтверждения: это его собственный
        # контент, а письмо нужно, чтобы человек понял, куда пропало сообщение.
        security_notifications.enqueue_security_email(
            str(author.email),
            "Pismo: сообщение скрыто до проверки",
            _author_message(
                message, len(reporters), lang=await locale_of_user(session, author.id)
            ),
        )
        logger.info("Автору %s отправлено письмо о скрытии сообщения", author.id)

    logger.warning(
        "Сообщение %s скрыто автоматически (%s жалоб от разных пользователей)",
        message.id,
        len(reporters),
    )
    return message


async def apply_report_status(
    session: AsyncSession,
    report: UserReport,
    *,
    moderator_id: int,
    status: str,
    note: str | None,
) -> dict[str, bool]:
    """Применяет решение модератора: скрывает/восстанавливает контент и уведомляет.

    Возвращает словарь с тем, что реально изменилось (``hidden``/``restored``),
    чтобы эндпоинт мог рассказать об этом модератору.
    """
    changed = {"hidden": False, "restored": False}
    message: Message | None = None
    if report.message_id is not None:
        message = await session.get(Message, report.message_id)

    if status == "resolved" and message is not None and message.hidden_at is None:
        message.hidden_at = _now()
        message.hidden_reason = note or "нарушение подтверждено модератором"
        await session.commit()
        changed["hidden"] = True
        await log_action(
            session,
            action=ACTION_MESSAGE_HIDDEN,
            moderator_id=moderator_id,
            target_user_id=message.user_id,
            report_id=report.id,
            message_id=message.id,
            note=note or "нарушение подтверждено",
        )

    if status == "rejected" and message is not None and message.hidden_at is not None:
        # Отклонённая жалоба снимает скрытие: контент возвращается в чаты.
        message.hidden_at = None
        message.hidden_reason = None
        await session.commit()
        changed["restored"] = True
        await log_action(
            session,
            action=ACTION_MESSAGE_RESTORED,
            moderator_id=moderator_id,
            target_user_id=message.user_id,
            report_id=report.id,
            message_id=message.id,
            note=note or "жалоба отклонена, контент восстановлен",
        )

    await log_action(
        session,
        action=ACTION_REPORT_STATUS_CHANGED,
        moderator_id=moderator_id,
        target_user_id=report.reported_id,
        report_id=report.id,
        message_id=report.message_id,
        note=f"{STATUS_TITLES.get(status, status)}: {note or 'без заметки'}",
    )

    reporter = await session.get(User, report.reporter_id)
    if reporter is not None and reporter.email:
        lang = await locale_of_user(session, reporter.id)
        security_notifications.enqueue_security_email(
            str(reporter.email),
            t("Pismo: жалоба рассмотрена", lang=lang),
            _moderation_message(report, lang=lang),
        )
    return changed


async def list_journal(
    session: AsyncSession, *, limit: int = 100, offset: int = 0
) -> tuple[list[ModerationAction], int]:
    """Журнал модерации (свежие сверху) + общее количество записей."""
    total = await session.scalar(select(func.count()).select_from(ModerationAction))
    stmt = (
        select(ModerationAction)
        .order_by(ModerationAction.created_at.desc(), ModerationAction.id.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = list((await session.execute(stmt)).scalars().all())
    return rows, int(total or 0)


async def hidden_messages_count(session: AsyncSession) -> int:
    """Сколько сообщений сейчас скрыто (для сводки в экране модерации)."""
    return int(
        await session.scalar(
            select(func.count())
            .select_from(Message)
            .where(Message.hidden_at.is_not(None))
        )
        or 0
    )


async def unhide_all_for_user(session: AsyncSession, *, user_id: int) -> int:
    """Снимает скрытие со всех сообщений автора (например, при ложном блоке).

    Используется при удалении аккаунта/разборе инцидента: администратор может
    вернуть контент одним действием, и это попадает в журнал.
    """
    result = await session.execute(
        update(Message)
        .where(Message.user_id == user_id, Message.hidden_at.is_not(None))
        .values(hidden_at=None, hidden_reason=None)
    )
    await session.commit()
    return int(result.rowcount or 0)


__all__ = [
    "REASON_TITLES",
    "STATUS_TITLES",
    "apply_report_status",
    "distinct_reporters",
    "hidden_messages_count",
    "list_journal",
    "log_action",
    "maybe_auto_hide",
    "unhide_all_for_user",
]
