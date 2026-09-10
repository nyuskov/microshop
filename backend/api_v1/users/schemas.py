"""Pydantic-схемы пользователей."""

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

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


class ProfileUpdateSchema(BaseModel):
    bio: str | None = None
    birth_date: str | None = None
    language: str | None = None
    country: str | None = None
    notifications_enabled: bool | None = None
    privacy_mode: bool | None = None


class UserAvatarResponse(BaseModel):
    avatar_url: str | None = None


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
    status: str | None = None
    last_seen: datetime | None = None


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
    avatar_url: str | None = None
    status: str | None = None
    last_seen: datetime | None = None
    # Признак администратора: фронт показывает таким пользователям разбор жалоб
    # (сам эндпоинт разбора всё равно проверяет is_superuser на сервере).
    is_superuser: bool = False
    profile: ProfileSchema | None
    chats: list[ChatSchema] = Field(default_factory=list)

    _empty_str_to_none = field_validator("first_name", "last_name", mode="before")(
        _empty_str_to_none
    )


class UserUpdateWithProfileSchema(BaseModel):
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
