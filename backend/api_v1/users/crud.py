from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.models import User, Profile, Post, Group  # Импортируем Group
from .schemas import UserSchema, CreateUser


async def get_users_with_posts_and_profiles(session: AsyncSession):
    stmt = select(User).options(
        selectinload(User.posts),
        selectinload(User.profile),
    )
    result = await session.scalars(stmt)
    return result.all()


async def get_user(session: AsyncSession, user_id: int) -> Optional[User]:
    stmt = select(User).where(User.id == user_id).options(
        selectinload(User.posts),
        selectinload(User.profile),
    )
    result = await session.scalars(stmt)
    return result.first()


async def get_user_by_username(session: AsyncSession, username: str) -> Optional[User]:
    stmt = select(User).where(User.username == username)
    result = await session.scalars(stmt)
    return result.first()


async def create_user(
    new_user: CreateUser,
    session: AsyncSession,
) -> User:
    new_user_profile_data = {
        "first_name": new_user.first_name,
        "last_name": new_user.last_name,
        "bio": new_user.bio,
    }
    new_user_data = new_user.model_dump(exclude={"first_name", "last_name", "bio"})
    user = User(**new_user_data)
    profile = Profile(**new_user_profile_data)
    user.profile = profile
    session.add(user)
    await session.commit()

    return user


# --- Новая CRUD-функция ---
async def get_groups_for_user(
    session: AsyncSession,
    user_id: int,
) -> list[Group]: # Возвращаем список ORM объектов Group
    """
    Получает список групп, к которым принадлежит пользователь.
    """
    stmt = select(User).where(User.id == user_id).options(selectinload(User.groups))
    result = await session.scalars(stmt)
    user = result.first()
    if user:
        return user.groups # Возвращаем список групп
    return [] # Если пользователь не найден, возвращаем пустой список
# --- Конец новой CRUD-функции ---