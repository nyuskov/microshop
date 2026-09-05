"""Pydantic-схемы чатов."""

from pydantic import BaseModel, ConfigDict


class ChatBase(BaseModel):
    name: str


class ChatCreate(ChatBase):
    pass


class ChatUpdate(BaseModel):
    name: str | None = None


class ChatUpdatePartial(ChatUpdate):
    pass


class Chat(ChatBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
