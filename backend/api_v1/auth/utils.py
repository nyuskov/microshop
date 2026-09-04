import secrets
import jwt  # Добавляем импорт jwt
from datetime import datetime, timedelta, timezone
from typing import Annotated

# Убираем импорт bcrypt и passlib
# import bcrypt
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
from fastapi import Depends, HTTPException, status
from fastapi.security import (
    HTTPBasic,
    HTTPBasicCredentials,
    OAuth2PasswordBearer,
)

# from passlib.context import CryptContext # Не импортируем CryptContext
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.models import db_helper
from core.security import (
    password_hasher,
)  # Импортируем password_hasher из core.security с абсолютным путем
from ..tokens.schemas import TokenData
from ..users.crud import (
    get_user_by_username,
    get_user_by_phone_number,
    get_user_by_id,  # Импортирую новую функцию
)
from ..users.schemas import CurrentUser

# Убираю старое определение констант, так как они могут конфликтовать с fastapi_users
# from .helpers import ACCESS_TOKEN_TYPE, TOKEN_TYPE_FIELD
# ACCESS_TOKEN_TYPE = "access"
# TOKEN_TYPE_FIELD = "type"

# Новые константы, совместимые с fastapi-users
ACCESS_TOKEN_TYPE = "access"
TOKEN_TYPE_FIELD = "token_type"  # Изменено на "token_type"

# # Создаем глобальный экземпляр PasswordHash, использующий argon2
# password_hasher = PasswordHash(hashers=[Argon2Hasher()]) # Удаляем дублирующее определение

security = HTTPBasic()


def encode_jwt(
    payload: dict,
    # Убираем параметры, связанные с файлами сертификатов
    # private_key: str = settings.auth_jwt.private_key_path.read_text(),
    # algorithm: str = settings.auth_jwt.algorithm,
    # expire_minutes: int = settings.auth_jwt.access_token_expire_minutes,
    expire_timedelta: timedelta | None = None,
) -> str:
    """Служебная функция для генерации нового токена"""
    to_encode = payload.copy()
    now = datetime.now(timezone.utc)
    # expire_minutes = settings.auth_jwt.access_token_expire_minutes
    if expire_timedelta:
        expire = now + expire_timedelta
    else:
        expire = now + timedelta(minutes=settings.auth_jwt.access_token_expire_minutes)
    to_encode.update(
        exp=expire,
        iat=now,
    )
    # Используем secret_key и algorithm из настроек
    encoded = jwt.encode(
        to_encode,
        settings.auth_jwt.secret_key,
        algorithm=settings.auth_jwt.algorithm,  # settings.auth_jwt.algorithm
    )
    return encoded


def decode_jwt(
    token: str | bytes,
    # Убираем параметры, связанные с файлами сертификатов
    # public_key: str = settings.auth_jwt.public_key_path.read_text(),
    # algorithm: str = settings.auth_jwt.algorithm,
) -> str:
    """Служебная функция для получения декодированного токена"""
    # Используем secret_key и algorithm из настроек
    decoded = jwt.decode(
        token,
        settings.auth_jwt.secret_key,
        algorithms=[settings.auth_jwt.algorithm],  # settings.auth_jwt.algorithm
    )
    return decoded


def validate_password(
    password: str,
    hashed_password: str,  # pwdlib возвращает строку, а не байты
) -> bool:
    # Используем pwdlib для проверки пароля
    return password_hasher.verify(password, hashed_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Функция для проверки, соответствует ли полученный
    пароль сохраненному хэшу"""
    # Используем pwdlib вместо CryptContext
    return password_hasher.verify(plain_password, hashed_password)


async def authenticate_user(
    username_or_phone: str,  # Renamed parameter to reflect dual purpose
    password: str,
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Функция для проверки подлинности и возврата пользователя"""

    # First, try to find by username
    user = await get_user_by_username(session, username_or_phone)
    if not user:
        # If not found by username, try by phone number
        user = await get_user_by_phone_number(session, username_or_phone)

    # Check if user data was retrieved
    if not user:
        return None
    # Check if the provided password matches the hashed password in the database
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

    # Добавляем поля 'token_type' и 'sub' для совместимости с fastapi-users
    to_encode.update(
        {
            "exp": expire,
            TOKEN_TYPE_FIELD: ACCESS_TOKEN_TYPE,  # type: "access"
            # "sub": data.get("sub"), # sub уже должен быть в data
        }
    )

    # Используем secret_key и algorithm из настроек
    encoded_jwt = jwt.encode(
        to_encode,
        settings.auth_jwt.secret_key,
        algorithm=settings.auth_jwt.algorithm,  # settings.auth_jwt.algorithm
    )
    return encoded_jwt


async def get_current_user(
    token: Annotated[str, Depends(OAuth2PasswordBearer(tokenUrl="token"))],
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
        # Используем secret_key и algorithm из настроек
        payload = jwt.decode(
            token,
            settings.auth_jwt.secret_key,
            algorithms=[settings.auth_jwt.algorithm],  # settings.auth_jwt.algorithm
        )
        # вернем пользователя, зашитого в ключе
        sub_value: str = payload.get("sub")
        if sub_value is None:
            # нет пользователя, отдаем HTTP-ошибку.
            raise credentials_exception

        # Проверяем, является ли sub числом (ID пользователя), иначе считаем, что это username
        # Эта логика теперь является резервной, основная будет использовать username
        user = None
        if sub_value.isdigit():
            # Если sub - число, ищем по ID (для совместимости)
            user_id = int(sub_value)
            user = await get_user_by_id(session, user_id)
        else:
            # Если не число, считаем, что это username (новое поведение по умолчанию)
            user = await get_user_by_username(session, sub_value)

        if user is None:
            # нет пользователя, отдаем HTTP-ошибку.
            raise credentials_exception
        return user
    except jwt.InvalidTokenError:
        # если токен недействителен, отдадим HTTP-ошибку.
        raise credentials_exception


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


async def get_current_active_user(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
):
    """Проверяет запись пользователя по полю [disabled](file:///home/freedom/Документы/microshop/backend/api_v1/users/schemas.py#L25-L25)"""

    if current_user.disabled:
        # если пользователь отключен, то => HTTP=ошибка
        raise HTTPException(status_code=400, detail="Неактивный пользователь")
    return current_user
