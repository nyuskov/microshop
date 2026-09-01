from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import select, func  # Добавляем func для count
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.models import User, Profile, Post, Group  # Импортируем Group
from .schemas import UserSchema, CreateUser, UserCreatedResponseSchema
from core.security import get_password_hash  # Изменяем на абсолютный импорт


async def get_users_with_posts_and_profiles(session: AsyncSession):
    stmt = select(User).options(
        selectinload(User.posts),
        selectinload(User.profile),
    )
    result = await session.scalars(stmt)
    return result.all()


async def get_user(session: AsyncSession, user_id: int) -> Optional[User]:
    stmt = (
        select(User)
        .where(User.id == user_id)
        .options(
            selectinload(User.posts),
            selectinload(User.profile),
        )
    )
    result = await session.scalars(stmt)
    return result.first()


async def get_user_by_username(
    session: AsyncSession, username: str
) -> Optional[User]:
    stmt = select(User).where(User.username == username)
    result = await session.scalars(stmt)
    return result.first()


# --- Новая вспомогательная функция ---
async def get_total_users_count(session: AsyncSession) -> int:
    """
    Возвращает общее количество пользователей в базе данных.
    """
    stmt = select(func.count(User.id))
    result = await session.scalar(stmt)
    return result or 0  # Если результат None, возвращаем 0


# --- Конец новой функции ---


async def create_user(
    new_user: CreateUser,
    session: AsyncSession,
) -> (
    UserCreatedResponseSchema
):  # Изменяем возвращаемый тип на UserCreatedResponseSchema
    # Проверяем, существует ли пользователь с таким именем
    existing_user = await get_user_by_username(session, new_user.username)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"User with username '{new_user.username}' already exists",
        )

    # --- Проверяем, является ли это первым пользователем ---
    total_users = await get_total_users_count(session)
    is_first_user = total_users == 0
    # --- Конец проверки ---

    new_user_profile_data = {
        "first_name": new_user.first_name,
        "last_name": new_user.last_name,
        "bio": new_user.bio,
    }
    # Создаем словарь, исключив profile-related и password2 поля
    new_user_data = new_user.model_dump(
        exclude={"first_name", "last_name", "bio", "password2"}
    )
    # Хешируем пароль из оригинального объекта перед тем, как удалить его из словаря
    hashed_password = get_password_hash(new_user.password)
    # Удаляем plain-text 'password' из словаря, чтобы избежать передачи его в конструктор User
    new_user_data.pop("password", None)  # Явно удаляем 'password'

    # --- Устанавливаем is_superuser для первого пользователя ---
    if is_first_user:
        new_user_data["is_superuser"] = True
    # --- Конец установки is_superuser ---

    # Добавляем захешированный пароль
    new_user_data["hashed_password"] = hashed_password
    user = User(**new_user_data)
    profile = Profile(**new_user_profile_data)
    user.profile = profile
    session.add(user)
    try:
        await session.commit()
        # После коммита создаем и возвращаем объект схемы UserCreatedResponseSchema
        # Это гарантирует, что возвращается именно та схема, которую ожидает эндпоинт
        return UserCreatedResponseSchema.model_validate(user)
    except IntegrityError:
        # На случай, если произойдет другая ошибка целостности (например, email)
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User creation failed due to a conflict (e.g., duplicate email)",
        )


# --- Исправленная CRUD-функция ---
async def get_groups_for_user(
    session: AsyncSession,
    user_id: int,
) -> list[Group]:  # Возвращаем список ORM объектов Group
    """
    Получает список групп, к которым принадлежит пользователь.
    """
    # Сначала получаем ID групп, к которым принадлежит пользователь
    user_stmt = (
        select(User)
        .where(User.id == user_id)
        .options(selectinload(User.groups))
    )
    user_result = await session.scalars(user_stmt)
    user = user_result.first()

    if not user:
        return []  # Если пользователь не найден, возвращаем пустой список

    # Извлекаем ID групп
    group_ids = [g.id for g in user.groups]

    if not group_ids:
        return []  # Если у пользователя нет групп, возвращаем пустой список

    # Затем выбираем сами группы с загруженной связью users
    groups_stmt = (
        select(Group)
        .where(Group.id.in_(group_ids))
        .options(selectinload(Group.users))
    )
    groups_result = await session.scalars(groups_stmt)
    return list(
        groups_result.all()
    )  # Возвращаем список групп с загруженными пользователями


# --- Конец исправленной CRUD-функции ---
