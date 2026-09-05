"""Pydantic-схемы сообщений."""

from pydantic import BaseModel, ConfigDict


class MessageBase(BaseModel):
    text: str
    user_id: int
    chat_id: int


class MessageCreate(MessageBase):
    pass


class MessageUpdate(BaseModel):
    text: str | None = None
    user_id: int | None = None
    chat_id: int | None = None


class MessageUpdatePartial(MessageUpdate):
    pass


class Message(MessageBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
