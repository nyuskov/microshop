import secrets
from datetime import datetime, timedelta, timezone
import jwt
from passlib.context import CryptContext
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import (
    HTTPBasic,
    HTTPBasicCredentials,
    OAuth2PasswordBearer,
    OAuth2PasswordRequestForm,
)
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import db_helper
from core.models.user import User
from users.crud import get_user_by_username
from users.schemas import CurrentUser
from tokens.schemas import Token, TokenData

router = APIRouter(prefix="/auth", tags=["Аутентификация"])

security = HTTPBasic()

# для получения подобной строки, выполните: $ openssl rand -hex 32
SECRET_KEY = "d44c6e681a5a325c9bad6f7aee92d5cb6ebdbf1fd8732f90feef93ab1dbfb93a"
# алгоритм, используемый для подписи JWT-токена
ALGORITHM = "HS256"
# срок действия токена JWT-токена
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# фейковая запись пользователя из своеобразной `базы данных`
fake_users_db = {
    "johndoe": {
        # логин (для проверки авторизации)
        "username": "johndoe",
        "full_name": "John Doe",
        "email": "johndoe@example.com",
        # хеш пароля был получен выше
        "hashed_password": "$2b$12$9QNPD4oCa3zVlIm4LTfHKeHCdw02dDOdo4Vbbcta4.3gTAr62JYea",
        "disabled": False,
    }
}


#  функция для хэширования пароля, поступающего от пользователя.
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
# `oauth2_scheme` является "вызываемой" и следовательно ее можно
# использовать в зависимости `fastapi.Depends` в функции `get_current_user()`
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def verify_password(plain_password, hashed_password):
    """Функция для проверки, соответствует ли полученный пароль сохраненному хэшу"""
    return pwd_context.verify(plain_password, hashed_password)


async def authenticate_user(
    username: str,
    password: str,
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Функция для проверки подлинности и возврата пользователя"""

    user = await get_user_by_username(session, username)
    # проверяем, получены ли данные пользователя
    if not user:
        return None
    # проверяем соответствие пароля и хэша пароля из базы данных
    if not verify_password(password, user.hashed_password):
        return None
    return user


def create_access_token(data: dict, expires_delta: timedelta | None = None):
    """Служебная функция для генерации нового токена"""

    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def get_auth_user_username(
    credentials: Annotated[HTTPBasicCredentials, Depends(security)],
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    unauthed_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Неверное имя пользователя или пароль",
        headers={"WWW-Authenticate": "Basic"},
    )
    correct_password = ""
    user = await get_user_by_username(session, credentials.username)
    if user is not None:
        correct_password = user.password
    else:
        raise unauthed_exc
    if not secrets.compare_digest(
        credentials.password.encode("utf-8"),
        correct_password.encode("utf-8"),
    ):
        raise unauthed_exc

    return credentials.username


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Получение текущего пользователя из токена"""

    # создадим исключение, которое будем возвращать, если токен недействителен
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:  # расшифруем и проверим полученный токен
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        # вернем пользователя, зашитого в ключе
        username: str = payload.get("sub")
        if username is None:
            # нет пользователя, отдаем HTTP-ошибку.
            raise credentials_exception
        # сериализуем имя пользователя моделью Pydantic
        token_data = TokenData(username=username)
    except jwt.InvalidTokenError:
        # если токен недействителен, отдадим HTTP-ошибку.
        raise credentials_exception
    # пытаемся получить данные пользователя из базы
    user = await get_user_by_username(session, token_data.username)
    if user is None:
        # нет пользователя, отдаем HTTP-ошибку.
        raise credentials_exception
    return user


async def get_current_active_user(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
):
    """Проверяет запись пользователя по полю `disabled`"""

    if current_user.disabled:
        # если пользователь отключен, то => HTTP=ошибка
        raise HTTPException(status_code=400, detail="Неактивный пользователь")
    return current_user


@router.post("/token/")
def login_for_access_token(
    # аннотируем данные формы авторизации
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    user: User | None = Depends(authenticate_user),
) -> Token:
    """Функция авторизации пользователя. В случае успеха возвращает токен доступа"""

    # проходим проверку подлинности
    if not user:
        # не прошли проверку, отдаем HTTP-ошибку
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # устанавливаем время жизни токена
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
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
