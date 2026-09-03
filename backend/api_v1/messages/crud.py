from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Message


async def create_message(session: AsyncSession, message_create: dict) -> Message:
    """Создает новое сообщение."""
    new_message = Message(**message_create)
    session.add(new_message)
    await session.commit()
    return new_message


async def get_messages_by_chat_id(session: AsyncSession, chat_id: int) -> list[Message]:
    """Получает список сообщений для указанного чата."""
    stmt = select(Message).where(Message.chat_id == chat_id)
    result = await session.execute(stmt)
    return result.scalars().all()
