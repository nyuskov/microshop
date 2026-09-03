from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, joinedload

from core.models import (
    User,
    Profile,
    Chat,
    Message,
)  # Импортируем только используемые модели


async def create_user(session: AsyncSession, user: User) -> User:
    """Создает нового пользователя."""
    session.add(user)
    await session.commit()
    return user


async def get_user_with_profile(session: AsyncSession, user_id: int) -> User | None:
    """Получает пользователя вместе с его профилем."""
    stmt = select(User).options(joinedload(User.profile)).filter(User.id == user_id)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def get_user_chats(session: AsyncSession, user_id: int) -> list[Chat]:
    """Получает список чатов, в которых участвует пользователь."""
    stmt = (
        select(Chat)
        .join(Chat.users)
        .filter(User.id == user_id)
        .options(selectinload(Chat.users), selectinload(Chat.messages))
    )
    result = await session.execute(stmt)
    return result.scalars().all()


async def get_chat_with_users_and_messages(
    session: AsyncSession, chat_id: int
) -> Chat | None:
    """Получает чат вместе с его пользователями и сообщениями."""
    stmt = (
        select(Chat)
        .filter(Chat.id == chat_id)
        .options(selectinload(Chat.users), selectinload(Chat.messages))
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def get_messages_for_chat(session: AsyncSession, chat_id: int) -> list[Message]:
    """Получает список сообщений для конкретного чата."""
    stmt = (
        select(Message)
        .filter(Message.chat_id == chat_id)
        .order_by(Message.timestamp.asc())  # Сортировка по времени
        .options(joinedload(Message.user))  # Загружаем данные пользователя-отправителя
    )
    result = await session.execute(stmt)
    return result.scalars().all()
