from typing import Annotated
from annotated_types import MinLen, MaxLen
from pydantic import BaseModel, EmailStr


class CreateUser(BaseModel):
    email: EmailStr
    username: str = Annotated[str, MinLen(3), MaxLen(32)]
    password: str = Annotated[str, MinLen(8), MaxLen(32)]
