"""CRUD-операции для сообщений."""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.chats.crud import is_user_chat_member
from core.models import Chat, Message

_NOT_MEMBER_DETAIL = "Вы не являетесь участником этого чата"


async def create_message(
    session: AsyncSession, *, chat_id: int, text: str, user_id: int
) -> Message:
    """Создаёт сообщение от имени пользователя-участника чата."""
    chat = await session.get(Chat, chat_id)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Чат не найден",
        )
    if not await is_user_chat_member(session, chat_id=chat_id, user_id=user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_NOT_MEMBER_DETAIL,
        )

    message = Message(text=text, chat_id=chat_id, user_id=user_id)
    session.add(message)
    await session.commit()
    await session.refresh(message)
    return message


async def get_messages_by_chat_id(
    session: AsyncSession, *, chat_id: int, user_id: int
) -> list[Message]:
    """Возвращает сообщения чата, если пользователь является его участником."""
    chat = await session.get(Chat, chat_id)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Чат не найден",
        )
    if not await is_user_chat_member(session, chat_id=chat_id, user_id=user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_NOT_MEMBER_DETAIL,
        )

    result = await session.execute(
        select(Message)
        .where(Message.chat_id == chat_id)
        .order_by(Message.timestamp, Message.id)
    )
    return list(result.scalars().all())
