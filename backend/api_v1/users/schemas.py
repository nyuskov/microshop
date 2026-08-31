from typing import Annotated, Awaitable
from annotated_types import MinLen, MaxLen

from pydantic import BaseModel, ConfigDict, EmailStr

from core.models.profile import Profile


class User(BaseModel):
    username: Annotated[str, MinLen(3), MaxLen(32)]
    password: Annotated[str, MinLen(8), MaxLen(32)]


class CurrentUser(User):
    email: EmailStr | None = None
    disabled: bool | None = False


class CreateUser(User):
    model_config = ConfigDict(strict=True)
    password2: Annotated[str, MinLen(8), MaxLen(32)]
    email: EmailStr | None = None
    first_name: Annotated[str | None, MaxLen(40)] = None
    last_name: Annotated[str | None, MaxLen(40)] = None
    bio: Annotated[str | None, MaxLen(256)] = None


class UserSchema(BaseModel):
    model_config = ConfigDict(strict=True, arbitrary_types_allowed=True)
    username: str
    password: str
    awaitable_attrs: Awaitable[Profile]
    is_active: bool = True
    is_superuser: bool = False  # Добавляем поле is_superuser


# --- Новая схема ---
class PublicUserSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True) # Позволяет Pydantic заполнять схему из ORM объекта (например, SQLAlchemy)
    username: str
    email: EmailStr | None = None
    is_active: bool = True
    is_superuser: bool = False
    # Добавьте сюда поля профиля, если они нужны, например:
    # first_name: str | None = None
    # last_name: str | None = None
    # bio: str | None = None
# --- Конец новой схемы ---