from fastapi import APIRouter, Depends, Form, HTTPException, status
from fastapi.security import (
    OAuth2PasswordBearer,
)
from jwt.exceptions import InvalidTokenError
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import db_helper
from .utils import (
    validate_password,
    encode_jwt,
    decode_jwt,
)
from users.schemas import UserSchema
from users.crud import get_user_by_username
from ..tokens.schemas import Token


router = APIRouter(prefix="/jwt", tags=["JSON Web Tokens"])

# http_bearer = HTTPBearer()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/jwt/login/")


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

    # if not user.active:
    #     raise HTTPException(
    #         status_code=status.HTTP_403_FORBIDDEN,
    #         detail="Пользователь неактивен",
    #     )

    return user


def get_current_token_payload(
    token: str = Depends(oauth2_scheme),
):
    error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Неверный токен доступа",
    )
    try:
        payload = decode_jwt(token=token)
    except InvalidTokenError:
        raise error

    return payload


async def get_current_auth_user(
    session: AsyncSession = Depends(db_helper.session_dependency),
    payload: dict = Depends(get_current_token_payload),
) -> UserSchema:
    username: str | None = payload.get("sub")
    error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Неверный токен доступа",
    )
    if not (user := await get_user_by_username(session, username)):
        raise error
    return user


def get_current_active_auth_user(
    user: UserSchema = Depends(get_current_auth_user),
):
    if user.active:
        return user
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        detail="Пользователь неактивен",
    )


@router.post("/login/", response_model=Token)
async def auth_user_issue_jwt(
    user: UserSchema = Depends(validate_auth_user),
) -> Token:
    jwt_payload = {
        "sub": user.username,
        "username": user.username,
        "email": (await user.awaitable_attrs.profile).email,
        # "logged_in_at":,
    }
    token = encode_jwt(jwt_payload)
    return Token(
        access_token=token,
        token_type="Bearer",
    )


@router.get("/users/me/")
def auth_user_check_self_info(
    payload: dict = Depends(get_current_token_payload),
    user: UserSchema = Depends(get_current_active_auth_user),
) -> dict:
    OAuth2PasswordBearer
    return {
        "username": user.username,
        "email": user.email,
        "logged_in_at": payload.get("iat"),
    }
