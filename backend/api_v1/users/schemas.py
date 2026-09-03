from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
)


class CurrentUser(BaseModel):
    username: str


class UserSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    first_name: str | None = None
    last_name: str | None = None
    email: EmailStr | None = None


class PublicUserSchema(BaseModel):  # noqa: F821
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
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


class UserCreatedResponseSchema(BaseModel):
    id: int
    username: str


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
