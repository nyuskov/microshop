"""Pydantic-схемы чатов."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ChatCreate(BaseModel):
    name: str


class PrivateChatCreate(BaseModel):
    user_id: int


class ChatUserSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    first_name: str | None = None
    last_name: str | None = None
    phone_number: str | None = None


class MessageSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    text: str
    user_id: int
    chat_id: int
    timestamp: datetime


class Chat(BaseModel):
    id: int
    name: str
    users: list[ChatUserSchema] = []
    last_message: MessageSchema | None = None
