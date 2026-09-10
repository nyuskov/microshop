from pydantic import BaseModel


class RequestOTPRequest(BaseModel):
    phone_number: str


class VerifyOTPRequest(BaseModel):
    phone_number: str
    otp: str


class OTPResponse(BaseModel):
    detail: str


class PasswordStatusRequest(BaseModel):
    phone_number: str


class PasswordStatusResponse(BaseModel):
    """Что известно о номере до входа.

    ``otp_available`` — можно ли реально доставить код на этот номер (настроен
    SMS-шлюз/Telegram Gateway либо у аккаунта привязан Telegram-бот). Фронт
    сначала предлагает вход по коду, а если канал недоступен — сразу создание
    пароля, чтобы пользователь не встал на мёртвом шаге.
    """

    registered: bool
    has_password: bool
    otp_available: bool = False


class PasswordRequest(BaseModel):
    phone_number: str
    password: str


class PasswordSetRequest(BaseModel):
    """Установка/смена пароля текущего пользователя.

    После входа по OTP текущего пароля нет — ``current_password`` не нужен.
    Если пароль уже задан, смена требует его подтверждения.
    """

    password: str
    current_password: str | None = None


class PasswordSetResponse(BaseModel):
    detail: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: str | None = None
