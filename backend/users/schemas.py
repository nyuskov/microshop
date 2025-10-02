from typing import Annotated
from annotated_types import MinLen, MaxLen

from fastapi.param_functions import Form
from pydantic import BaseModel, EmailStr


class User(BaseModel):
    username: Annotated[str, Form(), MinLen(3), MaxLen(32)]
    password: Annotated[str, Form(pattern="^password$"), MinLen(8), MaxLen(32)]


class CurrentUser(User):
    email: EmailStr
    disabled: bool | None = False
