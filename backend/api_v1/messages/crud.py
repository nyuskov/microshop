from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Message, User


async def create_message(session: AsyncSession, message_create: dict) -> Message:
    """Создает новое сообщение."""
    # Проверяем, существует ли пользователь
    user_id = message_create.get('user_id')
    if user_id:
        # Only check if user exists by counting rows with this ID
        user_count_stmt = select(User.id).where(User.id == user_id).limit(1)
        user_result = await session.execute(user_count_stmt)
        user = user_result.scalar_one_or_none()

        if not user:
            from fastapi import HTTPException

            raise HTTPException(
                status_code=400, detail=f"User with id {user_id} does not exist"
            )

    new_message = Message(**message_create)
    session.add(new_message)
    await session.commit()
    return new_message


async def get_messages_by_chat_id(session: AsyncSession, chat_id: int) -> list[Message]:
    """Получает список сообщений для указанного чата."""
    stmt = select(Message).where(Message.chat_id == chat_id)
    result = await session.execute(stmt)
    return result.scalars().all()
