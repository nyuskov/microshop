"""CRUD блокировок и жалоб (модерация пользовательского контента)."""

from datetime import datetime, timezone

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Message, User, UserBlock, UserReport


async def block_user(
    session: AsyncSession,
    *,
    blocker_id: int,
    blocked_id: int,
    messages_allowed: bool = False,
) -> None:
    """Блокирует пользователя (идемпотентно).

    ``messages_allowed=True`` — мягкая блокировка: «не звони, но писать можно».
    Повторный вызов меняет вид блокировки, а не создаёт вторую запись (на пару
    есть уникальный индекс).
    """
    existing = await session.scalar(
        select(UserBlock)
        .where(
            UserBlock.blocker_id == blocker_id,
            UserBlock.blocked_id == blocked_id,
        )
        .limit(1)
    )
    if existing is None:
        session.add(
            UserBlock(
                blocker_id=blocker_id,
                blocked_id=blocked_id,
                messages_allowed=messages_allowed,
            )
        )
    elif existing.messages_allowed != messages_allowed:
        existing.messages_allowed = messages_allowed
    else:
        # Ничего не изменилось — коммит не нужен.
        return
    await session.commit()


async def unblock_user(
    session: AsyncSession, *, blocker_id: int, blocked_id: int
) -> None:
    """Снимает блокировку (идемпотентно)."""
    await session.execute(
        delete(UserBlock).where(
            UserBlock.blocker_id == blocker_id,
            UserBlock.blocked_id == blocked_id,
        )
    )
    await session.commit()


async def get_blocked_ids(session: AsyncSession, *, blocker_id: int) -> set[int]:
    """ID пользователей, которых ``blocker_id`` заблокировал ПОЛНОСТЬЮ.

    Мягкие блокировки («только звонки») сюда не попадают намеренно: переписка
    с таким человеком продолжается, и прятать чат из списка нельзя.
    """
    rows = await session.execute(
        select(UserBlock.blocked_id).where(
            UserBlock.blocker_id == blocker_id,
            UserBlock.messages_allowed.is_(False),
        )
    )
    return set(rows.scalars().all())


async def get_blocked_users(
    session: AsyncSession, *, blocker_id: int
) -> list[tuple[User, bool]]:
    """Заблокированные мной: пользователь и признак «сообщения разрешены».

    Вид блокировки нужен экрану «Заблокированные»: иначе нельзя показать, что
    человеку запрещены только звонки, и нельзя переключить вид обратно.
    """
    stmt = (
        select(User, UserBlock.messages_allowed)
        .join(UserBlock, UserBlock.blocked_id == User.id)
        .where(UserBlock.blocker_id == blocker_id)
        .order_by(UserBlock.created_at.desc())
    )
    result = await session.execute(stmt)
    return [(user, bool(messages_allowed)) for user, messages_allowed in result.all()]


async def get_block_messages_allowed(
    session: AsyncSession, *, blocker_id: int, blocked_id: int
) -> bool | None:
    """Вид МОЕЙ блокировки: None — не блокировал, иначе ``messages_allowed``.

    Нужно интерфейсу: в меню чата должны быть верные подписи («Заблокировать»
    или «Разблокировать», «Не принимать звонки» или «Принимать звонки»).
    Чужие блокировки не показываем — это личное дело собеседника.
    """
    found = await session.scalar(
        select(UserBlock.messages_allowed)
        .where(
            UserBlock.blocker_id == blocker_id,
            UserBlock.blocked_id == blocked_id,
        )
        .limit(1)
    )
    return None if found is None else bool(found)


async def is_blocked_between(
    session: AsyncSession, *, user_id: int, other_id: int
) -> bool:
    """Полная блокировка между парой (в любую сторону): сообщения запрещены."""
    return await _has_block(session, user_id=user_id, other_id=other_id, any_kind=False)


async def is_call_blocked_between(
    session: AsyncSession, *, user_id: int, other_id: int
) -> bool:
    """Любая блокировка между парой: звонок запрещён в обоих видах.

    Для звонков годится и полная блокировка, и мягкая («только звонки») —
    во втором случае человек как раз и просил не звонить.
    """
    return await _has_block(session, user_id=user_id, other_id=other_id, any_kind=True)


async def _has_block(
    session: AsyncSession, *, user_id: int, other_id: int, any_kind: bool
) -> bool:
    """Есть ли блокировка между парой (``any_kind`` — учитывать оба вида)."""
    conditions = or_(
        (UserBlock.blocker_id == user_id) & (UserBlock.blocked_id == other_id),
        (UserBlock.blocker_id == other_id) & (UserBlock.blocked_id == user_id),
    )
    if not any_kind:
        conditions = conditions & UserBlock.messages_allowed.is_(False)
    found = await session.scalar(select(UserBlock.id).where(conditions).limit(1))
    return found is not None


async def create_report(
    session: AsyncSession,
    *,
    reporter_id: int,
    reported_id: int,
    reason: str,
    comment: str | None = None,
    chat_id: int | None = None,
    message_id: int | None = None,
) -> UserReport:
    """Сохраняет жалобу на пользователя/сообщение."""
    report = UserReport(
        reporter_id=reporter_id,
        reported_id=reported_id,
        reason=reason,
        comment=comment,
        chat_id=chat_id,
        message_id=message_id,
    )
    session.add(report)
    await session.commit()
    await session.refresh(report)
    return report


async def list_reports(
    session: AsyncSession,
    *,
    status: str | None = None,
    reason: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[UserReport], int]:
    """Список жалоб для модератора (свежие первыми) + общее количество."""
    conditions = []
    if status is not None:
        conditions.append(UserReport.status == status)
    if reason is not None:
        conditions.append(UserReport.reason == reason)

    total = await session.scalar(
        select(func.count()).select_from(UserReport).where(*conditions)
    )
    stmt = (
        select(UserReport)
        .where(*conditions)
        .order_by(UserReport.created_at.desc(), UserReport.id.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await session.execute(stmt)
    return list(result.scalars().all()), int(total or 0)


async def get_report(session: AsyncSession, *, report_id: int) -> UserReport | None:
    """Жалоба по id (или None)."""
    return await session.get(UserReport, report_id)


async def get_users_by_ids(
    session: AsyncSession, *, user_ids: set[int]
) -> dict[int, User]:
    """Пользователи по набору id (для имён в списке жалоб — один запрос)."""
    if not user_ids:
        return {}
    result = await session.execute(select(User).where(User.id.in_(user_ids)))
    return {user.id: user for user in result.scalars().all()}


async def get_messages_text(
    session: AsyncSession, *, message_ids: set[int]
) -> dict[int, str | None]:
    """Тексты сообщений по id (контекст жалобы, один запрос).

    Отдаём подписанное сообщение (``text``) или None для вложений/удалённых —
    модератору нужно видеть, на что именно пожаловались.
    """
    if not message_ids:
        return {}
    result = await session.execute(
        select(Message.id, Message.text).where(Message.id.in_(message_ids))
    )
    return {row.id: row.text for row in result.all()}


async def update_report_status(
    session: AsyncSession,
    report: UserReport,
    *,
    status: str,
    note: str | None,
) -> UserReport:
    """Меняет статус разбора; reviewed_at ставится при выходе из ``new``."""
    report.status = status
    if note is not None:
        report.note = note or None
    report.reviewed_at = None if status == "new" else datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(report)
    return report
