from datetime import timedelta, datetime
from typing import Annotated
import re
import secrets
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import (
    HTTPBasic,
    HTTPBasicCredentials,
    OAuth2PasswordRequestForm,
)
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.models import db_helper
from ..tokens.schemas import Token
from .utils import (
    authenticate_user,
    create_access_token,
    get_auth_user_username,
    # Удаляю импорт get_user_by_phone_number из utils, так как буду импортировать из crud
)

# Импортирую функции напрямую из crud
from ..users.crud import (
    get_user_by_phone_number,
    get_or_create_user_by_phone_number,
)

# Импортирую get_jwt_strategy из jwt модуля
from .jwt import get_jwt_strategy

router = APIRouter(prefix="/auth", tags=["Аутентификация"])

# --- Начало добавленного кода для OTP ---
# Временное хранилище OTP (НЕ для продакшена!)
# Структура: { phone_number: {'code': str, 'expires_at': datetime, 'session_id': str} }
otp_storage = {}

# Время жизни OTP в секундах (берем из настроек или 5 минут по умолчанию)
OTP_EXPIRE_SECONDS = getattr(settings, 'auth_otp_expire_seconds', 300)


def generate_otp_code() -> str:
    """Генерирует 6-значный числовый код OTP."""
    # token_hex(3) генерирует 6 шестнадцатеричных символов
    hex_code = secrets.token_hex(3)
    # Берем только цифры, если их недостаточно, дополняем
    digits_only = re.sub(r'[^0-9]', '', hex_code)
    # Убедимся, что длина 6, дополняя нулями или усекая
    return (
        f"{int(digits_only[:6]):06d}"
        if digits_only[:6]
        else f"{int(hex_code[:6], 16):06d}"
    )


def send_sms_otp(phone_number: str, otp_code: str):
    """
    Заглушка для отправки SMS.
    В реальности здесь должен быть вызов API провайдера SMS.
    """
    print(f"Sending SMS to {phone_number}: Your OTP code is {otp_code}")


def validate_phone_number_format(phone_number: str) -> bool:
    """
    Проверяет формат номера телефона.
    Простая проверка: +7 (___) ___-__-__ или +7__________
    """
    pattern = r'^\+7\s?\(?(\d{3})\)?[\s\.-]?(\d{3})[\s\.-]?(\d{2})[\s\.-]?(\d{2})$'
    return bool(re.match(pattern, phone_number))


# --- Конец добавленного кода для OTP ---

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
            detail="Неверное имя пользователя или пароль",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # устанавливаем время жизни токена
    access_token_expires = timedelta(
        minutes=settings.auth_jwt.access_token_expire_minutes
    )
    # генерируем токен доступа, используя user.username как sub
    access_token = create_access_token(
        data={"sub": str(user.id)}, expires_delta=access_token_expires
    )
    return Token(access_token=access_token, token_type="bearer")


# --- Начало добавленных эндпоинтов для OTP ---
class RequestOTPRequest(BaseModel):
    phone_number: str


class VerifyOTPRequest(BaseModel):
    phone_number: str
    otp: str


class OTPResponse(BaseModel):
    detail: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: str = None  # Добавлено поле для refresh токена, если используется


@router.post("/request-otp/", response_model=OTPResponse)
async def request_otp(request_data: RequestOTPRequest):
    """Эндпоинт для запроса OTP по номеру телефона."""
    phone_number = request_data.phone_number

    # 1. Валидация формата номера
    if not validate_phone_number_format(phone_number):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неверный формат номера телефона. Ожидается +7 (___) ___-__-__.",
        )

    # 2. Генерация OTP
    otp_code = generate_otp_code()
    expires_at = datetime.utcnow() + timedelta(seconds=OTP_EXPIRE_SECONDS)
    session_id = str(uuid4())  # Генерируем уникальный ID сессии

    # 3. Сохранение в хранилище
    otp_storage[phone_number] = {
        'code': otp_code,
        'expires_at': expires_at,
        'session_id': session_id,
    }

    # 4. Отправка SMS (заглушка)
    send_sms_otp(phone_number, otp_code)

    return OTPResponse(detail="Код OTP отправлен.")


@router.post("/verify-otp/", response_model=TokenResponse)
async def verify_otp(
    request_data: VerifyOTPRequest,
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Эндпоинт для верификации OTP и получения токена."""
    phone_number = request_data.phone_number
    otp_code = request_data.otp

    # 1. Проверка наличия кода в хранилище
    stored_data = otp_storage.get(phone_number)
    if not stored_data or stored_data['code'] != otp_code:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный код OTP.",
        )

    # 2. Проверка срока действия
    if datetime.utcnow() > stored_data['expires_at']:
        del otp_storage[phone_number]  # Удаляем просроченный код
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Код OTP истек.",
        )

    # 3. Получение или создание пользователя по номеру телефона
    user = await get_or_create_user_by_phone_number(session, phone_number)
    # if not user:
    #     # Если пользователь не найден, можно создать нового
    #     # или вернуть ошибку. В этом примере создадим нового.
    #     # Однако, в реальности часто требуют предварительную регистрацию.
    #     # raise HTTPException(
    #     #     status_code=status.HTTP_401_UNAUTHORIZED,
    #     #     detail="Пользователь с таким номером телефона не зарегистрирован.",
    #     # )
    #     # TODO: Реализовать создание пользователя по номеру телефона при первом входе
    #     # или отправку на отдельный эндпоинт регистрации с OTP.

    # 4. Успешная верификация - генерация токена с помощью JWTStrategy от fastapi_users
    jwt_strategy = get_jwt_strategy()
    # The strategy.write_token method takes a User instance
    access_token = await jwt_strategy.write_token(user)

    # Удаляем использованный OTP из хранилища
    del otp_storage[phone_number]

    # TODO: Реализовать генерацию refresh токена, если используется.
    # Пока возвращаем только access_token
    return TokenResponse(access_token=access_token, token_type="bearer")


# --- Конец добавленных эндпоинтов для OTP ---


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
