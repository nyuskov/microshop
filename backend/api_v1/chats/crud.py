from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Chat


async def create_chat(session: AsyncSession, chat_create: dict) -> Chat:
    """Создаёт новый чат."""
    new_chat = Chat(**chat_create)
    session.add(new_chat)
    await session.commit()
    await session.refresh(new_chat)
    return new_chat


async def get_chats(session: AsyncSession) -> list[Chat]:
    """Возвращает список всех чатов."""
    result = await session.execute(select(Chat).order_by(Chat.id))
    return list(result.scalars().all())
