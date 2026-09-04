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

from core.models import User, db_helper

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
@router.get("/users/me/", response_model=UserRead)
async def get_me(user=Depends(fastapi_users.current_user())):
    return user


# Также можно подключить маршруты аутентификации, если они нужны отдельно
# router.include_router(fastapi_users.get_auth_router(auth_backend))

# Опционально: определяю current_user как зависимость, если она используется в других местах
# current_user = fastapi_users.current_user()
# current_superuser = fastapi_users.current_user(optional=False, superuser=True)
