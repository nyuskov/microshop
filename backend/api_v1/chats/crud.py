from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Chat


async def create_chat(session: AsyncSession, chat_create: dict) -> Chat:
    """Создает новый чат."""
    new_chat = Chat(**chat_create)
    session.add(new_chat)
    await session.commit()
    return new_chat


async def get_chats(session: AsyncSession) -> list[Chat]:
    """Получает список всех чатов."""
    stmt = select(Chat)
    result = await session.execute(stmt)
    return result.scalars().all()
