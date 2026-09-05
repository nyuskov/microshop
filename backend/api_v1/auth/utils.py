"""Вспомогательные функции для аутентификации и работы с JWT."""

from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import (
    HTTPBasic,
    HTTPBasicCredentials,
    OAuth2PasswordBearer,
)
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.models import db_helper
from core.models.user import User
from core.security import verify_password

from ..users.crud import (
    get_user_by_id,
    get_user_by_phone_number,
    get_user_by_username,
)

security = HTTPBasic()
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.api_v1_prefix}/auth/token/",
)


def decode_jwt(token: str | bytes) -> dict:
    """Декодирует JWT-токен и возвращает payload.

    Проверка audience отключена, чтобы принимать и токены fastapi-users
    (содержат claim ``aud``). Подлинность токена гарантируется подписью HS256,
    а субъект дополнительно сверяется с базой данных.
    """
    return jwt.decode(
        token,
        settings.auth_jwt.secret_key,
        algorithms=[settings.auth_jwt.algorithm],
        options={"verify_aud": False},
    )


async def authenticate_user(
    username_or_phone: str,
    password: str,
    session: AsyncSession,
) -> User | None:
    """Проверяет учётные данные и возвращает пользователя."""
    user = await get_user_by_username(session, username_or_phone)
    if user is None:
        user = await get_user_by_phone_number(session, username_or_phone)

    if user is None or not verify_password(password, user.hashed_password):
        return None
    return user


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> User:
    """Возвращает текущего пользователя из токена."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Не удалось проверить учётные данные",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_jwt(token)
    except jwt.InvalidTokenError as exc:
        raise credentials_exception from exc

    sub_value = str(payload.get("sub", ""))
    if not sub_value:
        raise credentials_exception

    user = (
        await get_user_by_id(session, int(sub_value))
        if sub_value.isdigit()
        else await get_user_by_username(session, sub_value)
    )
    if user is None:
        raise credentials_exception
    return user


async def get_auth_user_username(
    credentials: Annotated[HTTPBasicCredentials, Depends(security)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> str:
    """Проверяет учётные данные HTTP Basic и возвращает имя пользователя."""
    unauthed_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Неверное имя пользователя или пароль",
        headers={"WWW-Authenticate": "Basic"},
    )
    user = await get_user_by_username(session, credentials.username)
    if user is None or not verify_password(
        credentials.password, user.hashed_password
    ):
        raise unauthed_exc

    return credentials.username
