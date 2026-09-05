"""CRUD-операции для сообщений."""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Message, User


async def create_message(session: AsyncSession, message_create: dict) -> Message:
    """Создаёт сообщение, проверяя существование автора."""
    user_id = message_create.get("user_id")
    if user_id is not None:
        user = await session.get(User, user_id)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Пользователь с id {user_id} не существует",
            )

    message = Message(**message_create)
    session.add(message)
    await session.commit()
    await session.refresh(message)
    return message


async def get_messages_by_chat_id(session: AsyncSession, chat_id: int) -> list[Message]:
    """Возвращает сообщения указанного чата."""
    result = await session.execute(
        select(Message).where(Message.chat_id == chat_id).order_by(Message.id)
    )
    return list(result.scalars().all())
