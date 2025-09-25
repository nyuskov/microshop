from typing import Annotated
from annotated_types import MinLen, MaxLen
from pydantic import BaseModel, EmailStr


class CreateUser(BaseModel):
    email: EmailStr
    name: str = Annotated[str, MinLen(3), MaxLen(20)]
