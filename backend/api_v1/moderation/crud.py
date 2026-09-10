"""CRUD блокировок и жалоб (модерация пользовательского контента)."""

from datetime import datetime, timezone

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Message, User, UserBlock, UserReport


async def block_user(
    session: AsyncSession, *, blocker_id: int, blocked_id: int
) -> None:
    """Блокирует пользователя (идемпотентно)."""
    existing = await session.scalar(
        select(UserBlock.id)
        .where(
            UserBlock.blocker_id == blocker_id,
            UserBlock.blocked_id == blocked_id,
        )
        .limit(1)
    )
    if existing is None:
        session.add(UserBlock(blocker_id=blocker_id, blocked_id=blocked_id))
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
    """ID пользователей, которых заблокировал ``blocker_id``."""
    rows = await session.execute(
        select(UserBlock.blocked_id).where(UserBlock.blocker_id == blocker_id)
    )
    return set(rows.scalars().all())


async def get_blocked_users(session: AsyncSession, *, blocker_id: int) -> list[User]:
    """Список заблокированных пользователей (для экрана «Заблокированные»)."""
    stmt = (
        select(User)
        .join(UserBlock, UserBlock.blocked_id == User.id)
        .where(UserBlock.blocker_id == blocker_id)
        .order_by(UserBlock.created_at.desc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def is_blocked_between(
    session: AsyncSession, *, user_id: int, other_id: int
) -> bool:
    """Есть ли блокировка между парой (в любую сторону)."""
    found = await session.scalar(
        select(UserBlock.id)
        .where(
            or_(
                (UserBlock.blocker_id == user_id) & (UserBlock.blocked_id == other_id),
                (UserBlock.blocker_id == other_id) & (UserBlock.blocked_id == user_id),
            )
        )
        .limit(1)
    )
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
