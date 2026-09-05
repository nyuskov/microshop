"""Pydantic-схемы постов."""

from pydantic import BaseModel, ConfigDict


class PostBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    body: str
    user_id: int


class PostCreate(BaseModel):
    title: str
    body: str


class PostUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
