from pydantic import BaseModel


class RequestOTPRequest(BaseModel):
    """Запрос кода подтверждения на номер.

    Каналы доставки привязаны к номеру (код в Telegram → SMS): так чужой номер
    зарегистрировать не получится — код получит только владелец.
    """

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

    ``otp_available`` — можно ли доставить код на этот номер (настроен SMS Aero
    («код в Telegram» → SMS) или Telegram Gateway, либо у аккаунта привязан
    Telegram-бот). Фронт сначала предлагает вход по коду, а если каналов нет —
    сразу создание пароля, чтобы пользователь не встал на мёртвом шаге.
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
