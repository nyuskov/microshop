from fastapi import Depends, FastAPI
from fastapi_users import FastAPIUsers
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from fastapi_users.schemas import (
    BaseUser,
    BaseUserUpdate,
)  # Импортирую базовые схемы
from fastapi.routing import APIRouter  # Импортирую APIRouter
from pydantic import field_validator  # Импортирую field_validator
from pydantic import Field  # Import Field for Pydantic v2
from typing import Optional  # Import Optional

from core.models import User, db_helper, Profile
from core.models.chat import Chat  # Импортируем модель Chat
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy import select  # Импортируем select

# Импортирую схемы из api_v1.users.schemas
from api_v1.users.schemas import (
    UserWithDetailsSchema,
    ProfileSchema,
    UserUpdateWithProfileSchema,
)

# Восстанавливаю импорты
from .db import get_user_db
from .managers import (
    UserManager,
)  # Импортирую UserManager напрямую, так как он кастомный


# Определяю схемы для пользователей
class UserRead(BaseUser):
    # Override the email field to make it optional (str | None)
    # Using Field(...) explicitly might be needed depending on BaseUser definition
    email: Optional[str] = Field(default=None)  # Make email optional

    @field_validator("email", mode="before")
    @classmethod
    def empty_str_to_none(cls, v):
        if v == "":
            return None
        return v


class UserUpdate(BaseUserUpdate):
    # Optionally, also make email optional in the update schema if needed
    email: Optional[str] = Field(default=None)


# Изменяю get_user_manager, чтобы он использовал мой UserManager
async def get_user_manager(
    user_db: SQLAlchemyUserDatabase[User, int] = Depends(get_user_db),
):
    # Возвращаю экземпляр нового UserManager
    return UserManager(user_db)


def get_jwt_strategy() -> JWTStrategy:
    from core.config import settings

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


fastapi_users = FastAPIUsers[User, int](
    get_user_manager=get_user_manager,
    auth_backends=[auth_backend],
)


# Восстанавливаю роутер и подключаю к нему маршруты пользователей
router = APIRouter(prefix="/jwt", tags=["JWT"])


# Подключаю маршруты аутентификации, включая /refresh/
router.include_router(
    fastapi_users.get_auth_router(auth_backend), prefix="/auth"
)


# Подключаю маршрут /me/ напрямую, с слешем
@router.get("/users/me/", response_model=UserWithDetailsSchema)
async def get_me(
    user=Depends(fastapi_users.current_user()),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    # Выполняем повторный запрос к базе данных с предварительной загрузкой связанных данных
    stmt = (
        select(User)
        .where(User.id == user.id)
        .options(selectinload(User.profile))
        .options(selectinload(User.chats))
    )
    result = await session.execute(stmt)
    user_with_relations = result.scalar_one_or_none()
    return user_with_relations


# PATCH endpoint for updating user profile
@router.patch("/users/me/", response_model=UserWithDetailsSchema)
async def update_me(
    user_update: UserUpdateWithProfileSchema,
    current_user=Depends(
        fastapi_users.current_user()
    ),  # Получаем текущего пользователя для проверки аутентификации и получения id
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    # Выполняем новый запрос к базе данных для получения текущего пользователя с предварительно загруженным профилем
    stmt = (
        select(User)
        .where(User.id == current_user.id)
        .options(selectinload(User.profile))
    )
    result = await session.execute(stmt)
    user_with_loaded_profile = result.scalar_one_or_none()

    if not user_with_loaded_profile:
        # В теории, этого не должно произойти, если current_user аутентифицирован
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="User not found")

    # Update user fields
    if user_update.username is not None:
        user_with_loaded_profile.username = user_update.username
    if user_update.phone_number is not None:
        user_with_loaded_profile.phone_number = user_update.phone_number
    if user_update.first_name is not None:
        user_with_loaded_profile.first_name = user_update.first_name
    if user_update.last_name is not None:
        user_with_loaded_profile.last_name = user_update.last_name
    if user_update.email is not None:
        user_with_loaded_profile.email = user_update.email

    # Работаем с уже загруженным профилем
    if user_with_loaded_profile.profile is None:
        profile = Profile(user_id=user_with_loaded_profile.id)
        session.add(profile)
        user_with_loaded_profile.profile = profile

    # Update profile fields
    profile_data = user_update.profile
    if profile_data:
        if profile_data.bio is not None:
            user_with_loaded_profile.profile.bio = profile_data.bio
        if profile_data.birth_date is not None:
            user_with_loaded_profile.profile.birth_date = (
                profile_data.birth_date
            )
        if profile_data.language is not None:
            user_with_loaded_profile.profile.language = profile_data.language
        if profile_data.country is not None:
            user_with_loaded_profile.profile.country = profile_data.country
        if profile_data.notifications_enabled is not None:
            user_with_loaded_profile.profile.notifications_enabled = (
                profile_data.notifications_enabled
            )
        if profile_data.privacy_mode is not None:
            user_with_loaded_profile.profile.privacy_mode = (
                profile_data.privacy_mode
            )

    await session.commit()

    # Выполняем повторный запрос к базе данных с предварительной загрузкой связанных данных для возврата полного объекта
    stmt = (
        select(User)
        .where(User.id == user_with_loaded_profile.id)
        .options(selectinload(User.profile))
        .options(selectinload(User.chats))
    )
    result = await session.execute(stmt)
    updated_user_with_relations = result.scalar_one_or_none()

    return updated_user_with_relations


# Также можно подключить маршруты аутентификации, если они нужны отдельно
# router.include_router(fastapi_users.get_auth_router(auth_backend))

# Опционально: определяю current_user как зависимость, если она используется в других местах
# current_user = fastapi_users.current_user()
# current_superuser = fastapi_users.current_user(optional=False, superuser=True)
