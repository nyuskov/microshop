from fastapi import Depends, Form, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jwt import InvalidTokenError
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import db_helper
from .helpers import ACCESS_TOKEN_TYPE, REFRESH_TOKEN_TYPE, TOKEN_TYPE_FIELD
from ..users.crud import get_user_by_username
from ..users.schemas import UserSchema
from .utils import decode_jwt, validate_password

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/jwt/login/")


def get_current_token_payload(
    token: str = Depends(oauth2_scheme),
):
    error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Неверный токен",
    )
    try:
        payload = decode_jwt(token=token)
    except InvalidTokenError:
        raise error

    return payload


def validate_token_type(
    token_type: str,
    session: AsyncSession = Depends(db_helper.session_dependency),
    payload: dict = Depends(get_current_token_payload),
) -> bool:
    current_token_type = payload.get(TOKEN_TYPE_FIELD)
    if current_token_type == token_type:
        return True
    raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Неверный тип токена {current_token_type!r} expected {
                token_type!r}",
        )


async def get_user_by_token_sub(
    payload: dict,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> UserSchema:
    username: str | None = payload.get("sub")
    error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Пользователь не найден",
    )
    if not (user := await get_user_by_username(session, username)):
        raise error
    return user


def get_auth_user_from_token_of_type(token_type: str):
    async def get_auth_user_from_token(
        session: AsyncSession = Depends(db_helper.session_dependency),
        payload: dict = Depends(get_current_token_payload),
    ) -> UserSchema:
        validate_token_type(token_type, session=session, payload=payload)
        return await get_user_by_token_sub(payload, session=session)

    return get_auth_user_from_token


get_current_auth_user = get_auth_user_from_token_of_type(ACCESS_TOKEN_TYPE)
get_current_auth_user_for_refresh = get_auth_user_from_token_of_type(
    REFRESH_TOKEN_TYPE)


def get_current_active_auth_user(
    user: UserSchema = Depends(get_current_auth_user),
):
    if user.is_active:
        return user
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        detail="Пользователь неактивен",
    )


async def validate_auth_user(
    session: AsyncSession = Depends(db_helper.session_dependency),
    username: str = Form(),
    password: str = Form(),
):
    unauthed_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Неверное имя пользователя или пароль",
    )
    if not (user := await get_user_by_username(session, username)):
        raise unauthed_exc

    if not validate_password(
        password=password,
        hashed_password=user.hashed_password,
    ):
        raise unauthed_exc

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Пользователь неактивен",
        )

    return user
