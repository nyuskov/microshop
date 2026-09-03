from pydantic import BaseModel


class ProfileBase(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    bio: str | None = None


class ProfileCreate(ProfileBase):
    pass


class ProfileUpdate(ProfileBase):
    first_name: str | None = None
    last_name: str | None = None
    bio: str | None = None


class ProfileUpdatePartial(ProfileBase):
    first_name: str | None = None
    last_name: str | None = None
    bio: str | None = None


class ProfileSchema(ProfileBase):
    id: int
