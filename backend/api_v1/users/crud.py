"""CRUD-операции для пользователей."""

import secrets
from uuid import uuid4

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.models import Post, User
from core.security import password_hasher


async def get_users(session: AsyncSession) -> list[User]:
    """Возвращает список всех пользователей."""
    result = await session.execute(select(User))
    return list(result.scalars().all())


async def get_users_with_profile(session: AsyncSession) -> list[User]:
    """Возвращает список пользователей вместе с профилями."""
    stmt = select(User).options(selectinload(User.profile)).order_by(User.id)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_user_by_id(session: AsyncSession, user_id: int) -> User | None:
    """Возвращает пользователя по id."""
    return await session.get(User, user_id)


async def get_user_by_username(session: AsyncSession, username: str) -> User | None:
    """Возвращает пользователя по имени."""
    result = await session.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()


async def search_users_by_query(
    session: AsyncSession,
    query: str,
    *,
    exclude_user_id: int | None = None,
    limit: int = 20,
) -> list[User]:
    """Ищет пользователей по логину или номеру телефона (частичное совпадение)."""
    pattern = f"%{query.strip()}%"
    stmt = select(User).where(
        or_(
            User.username.ilike(pattern),
            User.phone_number.ilike(pattern),
        )
    )
    if exclude_user_id is not None:
        stmt = stmt.where(User.id != exclude_user_id)
    stmt = stmt.order_by(User.id).limit(limit)

    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_user_by_phone_number(
    session: AsyncSession, phone_number: str
) -> User | None:
    """Возвращает пользователя по номеру телефона."""
    result = await session.execute(
        select(User).where(User.phone_number == phone_number)
    )
    return result.scalar_one_or_none()


async def get_user_with_profile(session: AsyncSession, user_id: int) -> User | None:
    """Возвращает пользователя вместе с профилем."""
    stmt = select(User).where(User.id == user_id).options(selectinload(User.profile))
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def get_user_with_chats(session: AsyncSession, user_id: int) -> User | None:
    """Возвращает пользователя вместе с его чатами."""
    stmt = select(User).where(User.id == user_id).options(selectinload(User.chats))
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def get_posts_for_user(session: AsyncSession, user_id: int) -> list[Post]:
    """Возвращает посты пользователя."""
    stmt = select(Post).where(Post.user_id == user_id).order_by(Post.id)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def create_user(session: AsyncSession, user: User) -> User:
    """Создаёт нового пользователя."""
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def delete_user(session: AsyncSession, user: User) -> None:
    """Удаляет пользователя."""
    await session.delete(user)
    await session.commit()


async def get_or_create_user_by_phone_number(
    session: AsyncSession, phone_number: str
) -> User:
    """Возвращает пользователя по номеру телефона или создаёт нового."""
    user = await get_user_by_phone_number(session, phone_number)
    if user is not None:
        return user

    new_user = User(
        username=f"phone_{uuid4().hex[:8]}",
        phone_number=phone_number,
        hashed_password=password_hasher.hash(secrets.token_urlsafe(32)),
        is_active=True,
        is_verified=True,
        email=None,
        first_name=None,
        last_name=None,
    )
    return await create_user(session, new_user)
