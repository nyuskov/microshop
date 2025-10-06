from typing import Annotated, Type
from annotated_types import MinLen, MaxLen

from pydantic import BaseModel, ConfigDict, EmailStr
from sqlalchemy.ext.asyncio import AsyncAttrs


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
    model_config = ConfigDict(strict=True)
    username: str
    password: str
    awaitable_attrs: Type[AsyncAttrs]
    active: bool = True
