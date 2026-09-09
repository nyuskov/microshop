"""CRUD-операции для чатов."""

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api_v1.events.service import notify_user
from core.models import Chat, ChatMute, Message, User, user_chat_association_table


async def get_chat_with_users(session: AsyncSession, chat_id: int) -> Chat | None:
    """Возвращает чат вместе с его участниками."""
    stmt = select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.users))
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
            user_chat_association_table.c.user_id.in_([first_user_id, second_user_id])
        )
        .group_by(user_chat_association_table.c.chat_id)
        .having(
            func.count(func.distinct(user_chat_association_table.c.user_id)) == 2,
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
    # Сообщаем собеседнику о новом чате (если он на связи) — иначе он увидит
    # его только при следующем опросе/синхронизации.
    await notify_user(
        second_user.id,
        {"type": "chat.new", "chat_id": chat.id, "user_id": first_user.id},
    )
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

    chat_id = await get_private_chat_id_between(session, first_user_id, second_user_id)
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


async def get_unread_counts(
    session: AsyncSession, chat_ids: list[int], user_id: int
) -> dict[int, int]:
    """Возвращает количество непрочитанных сообщений для каждого чата."""
    if not chat_ids:
        return {}

    stmt = (
        select(Message.chat_id, func.count(Message.id))
        .where(
            Message.chat_id.in_(chat_ids),
            Message.user_id != user_id,
            Message.is_read.is_(False),
        )
        .group_by(Message.chat_id)
    )
    result = await session.execute(stmt)
    return {chat_id: count for chat_id, count in result.all()}


async def get_muted_chat_ids(
    session: AsyncSession, *, user_id: int, chat_ids: list[int]
) -> set[int]:
    """Возвращает id чатов из ``chat_ids``, замьюченных пользователем."""
    if not chat_ids:
        return set()
    stmt = select(ChatMute.chat_id).where(
        ChatMute.user_id == user_id,
        ChatMute.chat_id.in_(chat_ids),
    )
    result = await session.execute(stmt)
    return set(result.scalars().all())


async def set_chat_muted(
    session: AsyncSession, *, chat_id: int, user_id: int, muted: bool
) -> bool:
    """Включает/выключает mute чата для пользователя (проверяя членство).

    Возвращает итоговое состояние mute.
    """
    if not await is_user_chat_member(session, chat_id=chat_id, user_id=user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Чат не найден",
        )
    if muted:
        exists = await session.scalar(
            select(ChatMute.user_id).where(
                ChatMute.user_id == user_id,
                ChatMute.chat_id == chat_id,
            )
        )
        if exists is None:
            session.add(ChatMute(user_id=user_id, chat_id=chat_id))
            await session.commit()
    else:
        await session.execute(
            delete(ChatMute).where(
                ChatMute.user_id == user_id,
                ChatMute.chat_id == chat_id,
            )
        )
        await session.commit()
    return muted


async def leave_chat(
    session: AsyncSession, *, chat_id: int, user_id: int, for_all: bool = False
) -> None:
    """Удаляет чат у текущего пользователя.

    ``for_all=False`` — «только у меня»: убирает пользователя из чата; если
    участников не осталось, удаляет и чат, и его сообщения.

    ``for_all=True`` — «для всех»: удаляет чат целиком (участники, сообщения).
    """
    if not await is_user_chat_member(session, chat_id=chat_id, user_id=user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Чат не найден",
        )

    if for_all:
        await session.execute(
            user_chat_association_table.delete().where(
                user_chat_association_table.c.chat_id == chat_id
            )
        )
        await session.execute(delete(Message).where(Message.chat_id == chat_id))
        await session.execute(delete(Chat).where(Chat.id == chat_id))
        await session.commit()
        return

    await session.execute(
        user_chat_association_table.delete().where(
            user_chat_association_table.c.chat_id == chat_id,
            user_chat_association_table.c.user_id == user_id,
        )
    )
    # Уходя из чата, снимаем и свой mute (иначе останется «висящая» запись).
    await session.execute(
        delete(ChatMute).where(
            ChatMute.chat_id == chat_id,
            ChatMute.user_id == user_id,
        )
    )

    remaining = await session.scalar(
        select(func.count())
        .select_from(user_chat_association_table)
        .where(user_chat_association_table.c.chat_id == chat_id)
    )
    if (remaining or 0) == 0:
        await session.execute(delete(Message).where(Message.chat_id == chat_id))
        await session.execute(delete(Chat).where(Chat.id == chat_id))

    await session.commit()
