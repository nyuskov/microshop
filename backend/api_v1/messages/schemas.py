"""Pydantic-схемы сообщений."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class MessageCreate(BaseModel):
    text: str = ""
    chat_id: int
    reply_to_id: int | None = None


class MessageFile(BaseModel):
    name: str
    url: str
    mime: str | None = None
    size: int | None = None


class ReactionSummary(BaseModel):
    emoji: str
    count: int
    reacted_by_me: bool = False


class Message(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    chat_id: int
    user_id: int
    text: str
    timestamp: datetime
    reply_to_id: int | None = None
    is_read: bool = False
    is_pinned: bool = False
    file: MessageFile | None = None
    reactions: list[ReactionSummary] = Field(default_factory=list)
