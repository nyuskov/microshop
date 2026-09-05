"""CRUD-операции для чатов."""

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.models import Chat, Message, User, user_chat_association_table


async def get_chat_with_users(
    session: AsyncSession, chat_id: int
) -> Chat | None:
    """Возвращает чат вместе с его участниками."""
    stmt = (
        select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.users))
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def is_user_chat_member(
    session: AsyncSession, chat_id: int, user_id: int
) -> bool:
    """Проверяет, является ли пользователь участником чата."""
    stmt = select(user_chat_association_table.c.user_id).where(
        user_chat_association_table.c.chat_id == chat_id,
        user_chat_association_table.c.user_id == user_id,
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none() is not None


async def get_private_chat_id_between(
    session: AsyncSession, first_user_id: int, second_user_id: int
) -> int | None:
    """Возвращает id чата, в котором состоят ровно два указанных пользователя."""
    stmt = (
        select(user_chat_association_table.c.chat_id)
        .where(
            user_chat_association_table.c.user_id.in_(
                [first_user_id, second_user_id]
            )
        )
        .group_by(user_chat_association_table.c.chat_id)
        .having(
            func.count(func.distinct(user_chat_association_table.c.user_id))
            == 2,
            func.count(user_chat_association_table.c.user_id) == 2,
        )
    )
    result = await session.execute(stmt)
    return result.scalars().first()


async def create_private_chat(
    session: AsyncSession, first_user: User, second_user: User
) -> Chat:
    """Создаёт приватный чат между двумя пользователями."""
    chat = Chat(name=second_user.username)
    chat.users = [first_user, second_user]
    session.add(chat)
    await session.commit()
    return chat


async def get_or_create_private_chat(
    session: AsyncSession, first_user_id: int, second_user_id: int
) -> Chat:
    """Возвращает существующий приватный чат или создаёт новый."""
    if first_user_id == second_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя начать переписку с самим собой",
        )

    second_user = await session.get(User, second_user_id)
    if second_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )

    chat_id = await get_private_chat_id_between(
        session, first_user_id, second_user_id
    )
    if chat_id is not None:
        chat = await get_chat_with_users(session, chat_id)
        if chat is not None:
            return chat

    first_user = await session.get(User, first_user_id)
    if first_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Пользователь не найден",
        )
    return await create_private_chat(session, first_user, second_user)


async def get_user_chats(session: AsyncSession, user_id: int) -> list[Chat]:
    """Возвращает чаты, в которых состоит пользователь, вместе с участниками."""
    subq = select(user_chat_association_table.c.chat_id).where(
        user_chat_association_table.c.user_id == user_id
    )
    stmt = (
        select(Chat)
        .where(Chat.id.in_(subq))
        .options(selectinload(Chat.users))
        .order_by(Chat.id)
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_last_messages(
    session: AsyncSession, chat_ids: list[int]
) -> dict[int, Message]:
    """Возвращает последнее сообщение для каждого чата."""
    if not chat_ids:
        return {}

    stmt = (
        select(Message)
        .where(Message.chat_id.in_(chat_ids))
        .order_by(Message.chat_id, Message.timestamp, Message.id)
    )
    result = await session.execute(stmt)

    last_by_chat: dict[int, Message] = {}
    for message in result.scalars().all():
        last_by_chat[message.chat_id] = message
    return last_by_chat
