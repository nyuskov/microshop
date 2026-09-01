from typing import Annotated, Awaitable, List # Добавим List
from annotated_types import MinLen, MaxLen

from pydantic import BaseModel, ConfigDict, EmailStr

from core.models.profile import Profile # Импортируем модель Profile
from api_v1.posts.schemas import PostBase # Импортируем существующую схему Post

# --- Новая схема для Profile ---
class ProfileSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    first_name: str | None = None
    last_name: str | None = None
    bio: str | None = None
    user_id: int
# --- Конец новой схемы ---

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
    id: int # Добавим id, если он нужен
# --- Конец новой схемы ---


# --- Новая схема для пользователя с деталями ---
class UserWithDetailsSchema(PublicUserSchema): # Наследуемся от PublicUserSchema
    profile: ProfileSchema | None = None # Добавляем профиль
    posts: List[PostBase] = [] # Добавляем список постов
# --- Конец новой схемы ---