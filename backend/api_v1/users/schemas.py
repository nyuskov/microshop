from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, validator


class CurrentUser(BaseModel):
    username: str


class UserSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    phone_number: str | None = None  # Added field
    first_name: str | None = None
    last_name: str | None = None
    email: EmailStr | None = None


class PublicUserSchema(BaseModel):  # noqa: F821
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    phone_number: str | None = None  # Added field
    email: EmailStr | None = None


class ProfileSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    bio: str | None


class ChatSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class UserWithDetailsSchema(BaseModel):  # noqa: F821
    model_config = ConfigDict(from_attributes=True)

    username: str
    phone_number: str | None = None  # Added field
    first_name: str | None
    last_name: str | None
    email: EmailStr | None
    profile: ProfileSchema | None
    chats: list[ChatSchema] = Field(default_factory=list)

    @field_validator("first_name", "last_name", mode="before")
    @classmethod
    def empty_str_to_none(cls, v):
        if v == "":
            return None
        return v


class CreateUser(BaseModel):
    username: str
    phone_number: str | None = None  # Added field
    password: str
    first_name: str | None = None
    last_name: str | None = None
    email: EmailStr | None = None

    @field_validator("first_name", "last_name", mode="before")
    @classmethod
    def empty_str_to_none(cls, v):
        if v == "":
            return None
        return v

    @validator('phone_number')
    def validate_phone_number(cls, v):
        if v is not None:
            # Простая валидация формата номера телефона
            # В реальном приложении можно использовать более сложную логику
            import re

            if not re.match(r'^\+?[\d\s\-\(\)]+$', v):
                raise ValueError('Invalid phone number format')
        return v


class UserCreatedResponseSchema(BaseModel):
    id: int
    username: str
    phone_number: str | None = None  # Added field


class GroupSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class PostSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    content: str
    author_id: int
