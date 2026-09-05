"""Pydantic-схемы пользователей."""

import re

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


class ChatSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class PostSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    body: str
    user_id: int


class UserSearchResultSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    first_name: str | None
    last_name: str | None
    phone_number: str | None = None
    avatar_url: str | None = None


class UserWithDetailsSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    phone_number: str | None = None
    first_name: str | None
    last_name: str | None
    email: EmailStr | None
    avatar_url: str | None = None
    profile: ProfileSchema | None
    chats: list[ChatSchema] = Field(default_factory=list)

    _empty_str_to_none = field_validator(
        "first_name", "last_name", mode="before"
    )(_empty_str_to_none)


class UserUpdateWithProfileSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    username: str | None = None
    phone_number: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    email: EmailStr | None = None
    profile: ProfileUpdateSchema | None = None

    _empty_str_to_none = field_validator(
        "first_name", "last_name", mode="before"
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

    _empty_str_to_none = field_validator(
        "first_name", "last_name", mode="before"
    )(_empty_str_to_none)


class UserCreatedResponseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    phone_number: str | None = None
