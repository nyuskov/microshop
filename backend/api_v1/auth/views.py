from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import (
    HTTPBasic,
    HTTPBasicCredentials,
    OAuth2PasswordRequestForm,
)
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.models import db_helper
from ..tokens.schemas import Token
from .utils import (
    authenticate_user,
    create_access_token,
    get_auth_user_username,
)


router = APIRouter(prefix="/auth", tags=["Аутентификация"])

security = HTTPBasic()


@router.post("/token/")
async def login_for_access_token(
    # аннотируем данные формы авторизации
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> Token:
    """Функция авторизации пользователя.
    В случае успеха возвращает токен доступа"""
    # проходим проверку подлинности
    user = await authenticate_user(
        form_data.username,
        form_data.password,
        session,
    )
    if not user:
        # не прошли проверку, отдаем HTTP-ошибку
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # устанавливаем время жизни токена
    access_token_expires = timedelta(
        minutes=settings.auth_jwt.access_token_expire_minutes
    )
    # генерируем токен доступа
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return Token(access_token=access_token, token_type="bearer")


@router.get("/basic-auth/")
def basic_auth_credentials(
    credentials: Annotated[HTTPBasicCredentials, Depends(security)],
):
    return {
        "message": "ok",
        "username": credentials.username,
        "password": credentials.password,
    }


@router.get("/basic-auth-username/")
def basic_auth_username(
    auth_username: str = Depends(get_auth_user_username),
):
    return {
        "message": "ok",
        "username": auth_username,
    }
