"""Pydantic-схемы сообщений."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class MessageBase(BaseModel):
    text: str
    chat_id: int


class MessageCreate(MessageBase):
    pass


class Message(MessageBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    timestamp: datetime
