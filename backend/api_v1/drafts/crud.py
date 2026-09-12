"""Запросы к таблице черновиков сообщений."""

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import MessageDraft


async def list_drafts(session: AsyncSession, *, user_id: int) -> list[MessageDraft]:
    """Черновики пользователя: свежие сверху."""
    stmt = (
        select(MessageDraft)
        .where(MessageDraft.user_id == user_id)
        .order_by(MessageDraft.updated_at.desc())
    )
    return list((await session.scalars(stmt)).all())


async def get_draft(
    session: AsyncSession, *, user_id: int, chat_id: int
) -> MessageDraft | None:
    """Черновик пользователя в конкретном чате (None — черновика нет)."""
    return await session.get(MessageDraft, (user_id, chat_id))


async def upsert_draft(
    session: AsyncSession, *, user_id: int, chat_id: int, text: str
) -> MessageDraft:
    """Создаёт или перезаписывает черновик (одна строка на пару пользователь+чат)."""
    row = await get_draft(session, user_id=user_id, chat_id=chat_id)
    if row is None:
        row = MessageDraft(user_id=user_id, chat_id=chat_id, text=text)
        session.add(row)
    else:
        row.text = text
    await session.commit()
    await session.refresh(row)
    return row


async def delete_draft(session: AsyncSession, *, user_id: int, chat_id: int) -> None:
    """Убирает черновик (текст стёрли или сообщение отправлено)."""
    await session.execute(
        delete(MessageDraft).where(
            MessageDraft.user_id == user_id,
            MessageDraft.chat_id == chat_id,
        )
    )
    await session.commit()
