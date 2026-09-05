"""Интеграция fastapi-users: JWT-аутентификация и профиль пользователя."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi_users import FastAPIUsers
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)
from fastapi_users.schemas import BaseUser, BaseUserUpdate
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from pydantic import Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api_v1.users.schemas import UserUpdateWithProfileSchema, UserWithDetailsSchema
from core.config import settings
from core.models import Profile, User, db_helper

from .db import get_user_db
from .managers import UserManager


class UserRead(BaseUser):
    # email опционален, т.к. возможна регистрация по номеру телефона
    email: Optional[str] = Field(default=None)  # type: ignore[assignment]

    @field_validator("email", mode="before")
    @classmethod
    def empty_str_to_none(cls, value: Optional[str]) -> Optional[str]:
        return None if value == "" else value


class UserUpdate(BaseUserUpdate):
    email: Optional[str] = Field(default=None)  # type: ignore[assignment]


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase[User, int] = Depends(  # type: ignore[type-var]
        get_user_db
    ),
) -> UserManager:
    return UserManager(user_db)


def get_jwt_strategy() -> JWTStrategy:
    return JWTStrategy(
        secret=settings.auth_jwt.secret_key,
        lifetime_seconds=settings.auth_jwt.access_token_expire_minutes * 60,
    )


bearer_transport = BearerTransport(tokenUrl="auth/jwt/login")

auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[User, int](  # type: ignore[type-var]
    get_user_manager=get_user_manager,
    auth_backends=[auth_backend],
)

router = APIRouter(prefix="/jwt", tags=["JWT"])
router.include_router(fastapi_users.get_auth_router(auth_backend), prefix="/auth")


@router.get("/users/me/", response_model=UserWithDetailsSchema)
async def get_me(
    user: User = Depends(fastapi_users.current_user()),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> User:
    """Возвращает данные текущего пользователя вместе с профилем и чатами."""
    stmt = (
        select(User)
        .where(User.id == user.id)
        .options(selectinload(User.profile), selectinload(User.chats))
    )
    result = await session.execute(stmt)
    return result.scalar_one()


@router.patch("/users/me/", response_model=UserWithDetailsSchema)
async def update_me(
    user_update: UserUpdateWithProfileSchema,
    current_user: User = Depends(fastapi_users.current_user()),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> User:
    """Обновляет данные и профиль текущего пользователя."""
    stmt = (
        select(User)
        .where(User.id == current_user.id)
        .options(selectinload(User.profile))
    )
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )

    user_data = user_update.model_dump(exclude_unset=True, exclude={"profile"})
    for field, value in user_data.items():
        setattr(user, field, value)

    if user_update.profile is not None:
        if user.profile is None:
            user.profile = Profile(user_id=user.id)
            session.add(user.profile)
        profile_data = user_update.profile.model_dump(exclude_unset=True)
        for field, value in profile_data.items():
            setattr(user.profile, field, value)

    await session.commit()

    stmt = (
        select(User)
        .where(User.id == user.id)
        .options(selectinload(User.profile), selectinload(User.chats))
    )
    result = await session.execute(stmt)
    return result.scalar_one()
