from pydantic import BaseModel


class PostBase(BaseModel):
    id: int
    title: str
    body: str
    user_id: int

    class Config:
        from_attributes = True


class PostCreate(BaseModel):
    title: str
    body: str


class PostUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
