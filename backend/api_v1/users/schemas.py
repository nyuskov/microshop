"""Pydantic-схемы пользователей."""

import re
from datetime import datetime

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from core import quiet_hours

PHONE_PATTERN = re.compile(r"^\+?[\d\s\-()]+$")


def _empty_str_to_none(value: str | None) -> str | None:
    return None if value == "" else value


class ProfileSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    bio: str | None
    birth_date: str | None
    language: str | None
    country: str | None
    notifications_enabled: bool
    privacy_mode: bool
    notification_preview: bool = True
    quiet_hours_enabled: bool = False
    quiet_hours_start: int = 1380
    quiet_hours_end: int = 480
    quiet_hours_allow_calls: bool = True
    quiet_hours_offset: int = 0


class ProfileUpdateSchema(BaseModel):
    bio: str | None = None
    birth_date: str | None = None
    language: str | None = None
    country: str | None = None
    notifications_enabled: bool | None = None
    privacy_mode: bool | None = None
    notification_preview: bool | None = None
    quiet_hours_enabled: bool | None = None
    quiet_hours_start: int | None = None
    quiet_hours_end: int | None = None
    quiet_hours_allow_calls: bool | None = None
    quiet_hours_offset: int | None = None

    @field_validator("quiet_hours_start", "quiet_hours_end")
    @classmethod
    def _check_minute_of_day(cls, value: int | None) -> int | None:
        """Граница окна — минуты от полуночи (0…1439)."""
        if value is None:
            return None
        if not 0 <= value < quiet_hours.MINUTES_IN_DAY:
            raise ValueError("Время должно быть в пределах суток (0…1439 минут)")
        return value

    @field_validator("quiet_hours_offset")
    @classmethod
    def _check_offset(cls, value: int | None) -> int | None:
        """Сдвиг часового пояса: от UTC−12 до UTC+14.

        Клиент присылает своё текущее значение ( ``-getTimezoneOffset()``), но
        мусор от чужого клиента всё равно отсекаем — иначе настройка «тихие
        часы» станет непредсказуемой.
        """
        if value is None:
            return None
        if (
            not quiet_hours.MIN_OFFSET_MINUTES
            <= value
            <= quiet_hours.MAX_OFFSET_MINUTES
        ):
            raise ValueError("Сдвиг часового пояса вне допустимых границ")
        return value


class UserAvatarResponse(BaseModel):
    avatar_url: str | None = None
    # Маленькая копия для списков и шапки (нет — показываем оригинал).
    avatar_thumb_url: str | None = None


class UserStorageResponse(BaseModel):
    """Заполненность хранилища медиа пользователя (для профиля)."""

    used_bytes: int = 0
    quota_bytes: int = 0
    files: int = 0
    percent: int = 0


# Строка-подтверждение для удаления аккаунта (защита от случайного нажатия).
DELETE_ACCOUNT_CONFIRM = "УДАЛИТЬ"


class DeleteAccountRequest(BaseModel):
    """Подтверждение удаления аккаунта (требование RuStore и 152-ФЗ).

    Нужны и пароль, и подтверждающая строка ``УДАЛИТЬ``: пароль подтверждает,
    что действие выполняет владелец аккаунта (для аккаунтов без собственного
    пароля проверяется только строка).
    """

    password: str | None = Field(default=None, max_length=128)
    confirm: str = Field(max_length=32)


class ChatSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class UserSearchResultSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    first_name: str | None
    last_name: str | None
    phone_number: str | None = None
    avatar_url: str | None = None
    # Маленькая копия для списков и шапки (нет — показываем оригинал).
    avatar_thumb_url: str | None = None
    status: str | None = None
    last_seen: datetime | None = None


class UserLinkPreviewSchema(BaseModel):
    """Данные пользователя для ссылки-профиля (`/u/<логин>`).

    Намеренно БЕЗ номера телефона: такую ссылку можно переслать в любой чат или
    опубликовать, и она не должна раскрывать персональные данные. Телефон
    остаётся виден только там, где он и раньше был — в списке контактов и в
    уже существующем чате (там это ожидаемо, ведь номер знает собеседник).
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    first_name: str | None
    last_name: str | None
    avatar_url: str | None = None
    # Маленькая копия для списков и шапки (нет — показываем оригинал).
    avatar_thumb_url: str | None = None
    status: str | None = None


class PhoneMatchRequest(BaseModel):
    """Номера из телефонной книги для поиска в мессенджере."""

    phones: list[str] = Field(default_factory=list)

    @field_validator("phones")
    @classmethod
    def validate_phones(cls, value: list[str]) -> list[str]:
        if len(value) > 500:
            raise ValueError("Слишком много номеров")
        cleaned: list[str] = []
        for item in value:
            if len(item) > 40:
                raise ValueError("Номер слишком длинный")
            cleaned.append(item.strip())
        return cleaned


class UserWithDetailsSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    phone_number: str | None = None
    first_name: str | None
    last_name: str | None
    email: EmailStr | None
    # Подтверждён ли адрес кодом из письма: только подтверждённый e-mail можно
    # использовать для входа без пароля и восстановления доступа.
    email_verified: bool = False
    avatar_url: str | None = None
    # Маленькая копия для списков и шапки (нет — показываем оригинал).
    avatar_thumb_url: str | None = None
    status: str | None = None
    last_seen: datetime | None = None
    # Признаки ролей: `is_admin` — разбор жалоб и приглашения (и обход экрана
    # техработ), `is_superuser` — владелец: то же плюс рубильник техработ.
    # Фронт по ним показывает админский раздел; сервер всё равно проверяет
    # права на каждом эндпоинте.
    is_admin: bool = False
    is_superuser: bool = False
    # Состояние безопасности аккаунта: фронт по этим флагам предлагает задать
    # пароль, добавить e-mail или сменить слабый пароль (см. профиль).
    password_set: bool = False
    password_weak: bool = False
    profile: ProfileSchema | None
    chats: list[ChatSchema] = Field(default_factory=list)

    _empty_str_to_none = field_validator("first_name", "last_name", mode="before")(
        _empty_str_to_none
    )


class UserUpdateWithProfileSchema(BaseModel):
    """Обновление своего профиля.

    Номер телефона изменить нельзя: это логин аккаунта и ключ, по которому
    выдаются OTP-коды. Поле осталось в схеме только для того, чтобы на попытку
    смены номера клиент получил понятную ошибку 422 (а не молчаливое игнорирование).
    """

    model_config = ConfigDict(from_attributes=True)

    username: str | None = None
    phone_number: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    email: EmailStr | None = None
    status: str | None = None
    profile: ProfileUpdateSchema | None = None

    _empty_str_to_none = field_validator(
        "first_name", "last_name", "status", mode="before"
    )(_empty_str_to_none)

    @model_validator(mode="after")
    def _reject_phone_number_change(self) -> "UserUpdateWithProfileSchema":
        """Отклоняет любую попытку передать номер телефона."""
        if "phone_number" in self.model_fields_set:
            raise ValueError("Номер телефона изменить нельзя")
        return self


class CreateUser(BaseModel):
    username: str
    phone_number: str | None = None
    password: str
    first_name: str | None = None
    last_name: str | None = None
    email: EmailStr | None = None

    @field_validator("phone_number")
    @classmethod
    def validate_phone_number(cls, value: str | None) -> str | None:
        if value is not None and not PHONE_PATTERN.match(value):
            raise ValueError("Неверный формат номера телефона")
        return value

    _empty_str_to_none = field_validator("first_name", "last_name", mode="before")(
        _empty_str_to_none
    )


class UserCreatedResponseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    phone_number: str | None = None
