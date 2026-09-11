from datetime import datetime

from pydantic import BaseModel, EmailStr


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

    ``otp_available`` — можно ли доставить код на номер (SMS Aero/Telegram Gateway
    или привязанный Telegram-бот). ``email_otp_available`` — включён ли канал
    писем (SMTP), ``email_login_available`` — есть ли у аккаунта подтверждённый
    e-mail, на который можно прислать код для входа без пароля.
    """

    registered: bool
    has_password: bool
    otp_available: bool = False
    email_otp_available: bool = False
    email_login_available: bool = False


class AuthChannelsResponse(BaseModel):
    """Какие каналы доставки кода включены на сервере.

    Публичный ответ — чтобы экран входа не показывал заведомо недоступные
    кнопки (например, вход по e-mail, когда SMTP не настроен).
    """

    otp_available: bool = False
    email_otp_available: bool = False


class EmailAddressRequest(BaseModel):
    """Адрес для подтверждения (привязан к текущему аккаунту)."""

    email: EmailStr


class EmailCodeConfirmRequest(BaseModel):
    """Код из письма для подтверждения адреса."""

    email: EmailStr
    code: str


class EmailLoginRequest(BaseModel):
    """Вход по адресу: код уйдёт на подтверждённый e-mail аккаунта."""

    email: EmailStr


class EmailLoginConfirmRequest(BaseModel):
    """Подтверждение входа кодом из письма (пароль не нужен)."""

    email: EmailStr
    code: str


class PasswordResetConfirmRequest(BaseModel):
    """Восстановление пароля: код из письма + новый пароль."""

    email: EmailStr
    code: str
    password: str


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
    """Результат смены пароля/выхода со всех устройств.

    При смене пароля все refresh-сессии отзываются, поэтому в ответе идут
    новые токены — текущее устройство остаётся в системе, остальные выходят.
    """

    detail: str
    access_token: str | None = None
    token_type: str = "bearer"
    refresh_token: str | None = None


class LogoutRequest(BaseModel):
    """Выход из аккаунта на этом устройстве (отзыв именно этой сессии)."""

    refresh_token: str | None = None


class RevokeAllRequest(BaseModel):
    """«Выйти на всех устройствах».

    ``refresh_token`` — сессия текущего устройства: её оставляем живой, чтобы
    владелец не вылетел сам. Без него гасим вообще всё (например, тревога из
    уведомления или запрос из чужого места).
    """

    refresh_token: str | None = None


class FreezeRequest(BaseModel):
    """Заморозка аккаунта: если пароль задан — подтверждаем его."""

    password: str | None = None


class FreezeResponse(BaseModel):
    """Результат заморозки: что именно произошло (для показа пользователю)."""

    detail: str
    frozen: bool
    # Канал, которым владелец сможет разморозить аккаунт (e-mail адреса).
    recovery_hint: str | None = None


class PanicRequest(BaseModel):
    """Тревога «это были не я» из push-уведомления (без access-токена)."""

    token: str


class PanicResponse(BaseModel):
    """Результат тревоги: сессии отозваны, аккаунт (если было чем) заморожен."""

    detail: str
    revoked: bool
    frozen: bool


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: str | None = None


class DeviceChallengeResponse(BaseModel):
    """Ответ на вход с нового устройства: нужен код из письма (токенов нет).

    Отдаётся с кодом 428 (``Precondition Required``), чтобы клиент не спутал этот
    ответ с успешным входом. ``challenge_token`` — подписанная сервером заявка
    «подтвердите вход с этого устройства»; её нужно вернуть вместе с кодом.
    """

    detail: str
    code_sent_to: str | None = None
    challenge_token: str | None = None
    expires_in: int = 0


class DeviceVerifyRequest(BaseModel):
    """Подтверждение входа с нового устройства кодом из письма."""

    challenge_token: str
    code: str


class AuthSessionSchema(BaseModel):
    """Один активный вход (устройство) в списке профиля."""

    id: int
    device: str
    ip: str
    created_at: datetime
    current: bool = False


class AuthSessionsResponse(BaseModel):
    """Список активных входов («Безопасность» → устройства)."""

    sessions: list[AuthSessionSchema]


class SessionRevokeResponse(BaseModel):
    """Результат отзыва одной сессии."""

    detail: str


class SecurityLogEntry(BaseModel):
    """Одно событие безопасности аккаунта (для профиля)."""

    id: int
    event: str
    title: str
    detail: str = ""
    ip: str = ""
    device: str = ""
    created_at: datetime


class SecurityLogResponse(BaseModel):
    """История событий аккаунта (свежие сверху)."""

    items: list[SecurityLogEntry]
