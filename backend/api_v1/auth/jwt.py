"""Интеграция fastapi-users: JWT-аутентификация и профиль пользователя."""

from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
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

from api_v1.auth.refresh_sessions import rotate_refresh_token
from api_v1.auth.schemas import TokenResponse
from api_v1.auth.utils import REFRESH_TOKEN_AUDIENCE, REFRESH_TOKEN_TYPE, decode_jwt
from api_v1.users.crud import get_user_by_id
from api_v1.users.schemas import UserUpdateWithProfileSchema, UserWithDetailsSchema
from core.config import settings
from core.models import Profile, User, db_helper

from .db import get_user_db
from .managers import UserManager
from .security_notifications import email_changed_message, notify_security_event


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
    request: Request,
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
    # Смена e-mail сбрасывает подтверждение: адрес мог быть указан ошибочно (или
    # чужим), а подтверждённый e-mail — это канал входа и восстановления пароля.
    email_changed = "email" in user_data and user_data["email"] != user.email
    old_email = str(user.email) if user.email else ""
    old_email_verified = bool(user.email_verified)
    for field, value in user_data.items():
        setattr(user, field, value)
    if email_changed:
        user.email_verified = False

    if user_update.profile is not None:
        if user.profile is None:
            user.profile = Profile(user_id=user.id)
            session.add(user.profile)
        profile_data = user_update.profile.model_dump(exclude_unset=True)
        for field, value in profile_data.items():
            setattr(user.profile, field, value)

    await session.commit()

    if email_changed and old_email and old_email_verified:
        # Письмо уходит на ПРЕЖНИЙ адрес: если адрес меняет не владелец аккаунта,
        # именно так настоящий владелец об этом узнаёт. Текущий адрес
        # уведомление не получит — он пока не подтверждён (это сделал бы
        # посторонний, кто получил доступ к аккаунту).
        await notify_security_event(
            session,
            user,
            event="email_changed",
            request=request,
            recipient=old_email,
            details=email_changed_message(
                old_email, str(user.email) if user.email else None
            ),
        )

    stmt = (
        select(User)
        .where(User.id == user.id)
        .options(selectinload(User.profile), selectinload(User.chats))
    )
    result = await session.execute(stmt)
    return result.scalar_one()


@router.post("/auth/refresh", response_model=TokenResponse)
async def refresh_access_token(
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> TokenResponse:
    """Обменивает refresh-токен на новую пару (access + refresh, ротация).

    Фронт держит refresh-токен в сторе и обращается сюда при 401 от API.
    Refresh-токен не является access-токеном (отдельный aud и claim type),
    поэтому сюда нельзя «подсунуть» обычный токен.
    """
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Недействительный refresh-токен",
        headers={"WWW-Authenticate": "Bearer"},
    )
    auth_header = request.headers.get("Authorization", "")
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise unauthorized

    try:
        payload = decode_jwt(token)
    except jwt.InvalidTokenError as exc:
        raise unauthorized from exc

    if (
        payload.get("type") != REFRESH_TOKEN_TYPE
        or payload.get("aud") != REFRESH_TOKEN_AUDIENCE
    ):
        raise unauthorized

    sub_value = str(payload.get("sub", ""))
    if not sub_value.isdigit():
        raise unauthorized

    jti = payload.get("jti")
    if not isinstance(jti, str) or not jti:
        # Токен без идентификатора сессии (старый формат) — не принимаем.
        raise unauthorized

    user = await get_user_by_id(session, int(sub_value))
    if user is None:
        raise unauthorized

    new_refresh_token = await rotate_refresh_token(session, jti=jti, user_id=user.id)
    if new_refresh_token is None:
        # Недействительный / истёкший / повторно использованный токен.
        raise unauthorized

    access_token = await get_jwt_strategy().write_token(user)
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        refresh_token=new_refresh_token,
    )
