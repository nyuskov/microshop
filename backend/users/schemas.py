from typing import Annotated
from annotated_types import MinLen, MaxLen

from fastapi.param_functions import Form
from pydantic import BaseModel, EmailStr


class User(BaseModel):
    username: Annotated[str, MinLen(3), MaxLen(32)]
    password: Annotated[str, MinLen(8), MaxLen(32)]


class CurrentUser(User):
    email: EmailStr | None = None
    disabled: bool | None = False


class CreateUser(User):
    password2: Annotated[str, MinLen(8), MaxLen(32)]
    email: EmailStr | None = None
    first_name: Annotated[str | None, MaxLen(40)] = None
    last_name: Annotated[str | None, MaxLen(40)] = None
    bio: Annotated[str | None, MaxLen(256)] = None
