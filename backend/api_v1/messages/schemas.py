"""Pydantic-схемы сообщений."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class MessageCreate(BaseModel):
    text: str = ""
    chat_id: int
    reply_to_id: int | None = None
    encrypted: bool = False


class EditMessageRequest(BaseModel):
    """Новый текст сообщения (редактирование)."""

    text: str = Field(..., min_length=1, max_length=4000)


class ForwardMessageRequest(BaseModel):
    """Переслать сообщение в другой чат."""

    message_id: int
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


class ForwardedFrom(BaseModel):
    """Данные плашки «Переслано от …» (снимок на момент пересылки)."""

    id: int
    sender_id: int | None = None
    sender_name: str = ""
    chat_id: int | None = None


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
    encrypted: bool = False
    edited_at: datetime | None = None
    # Системная отметка о звонке.
    kind: str = "text"
    call_kind: str | None = None
    call_state: str | None = None
    call_duration: int | None = None
    call_caller_id: int | None = None
    file: MessageFile | None = None
    reactions: list[ReactionSummary] = Field(default_factory=list)
    forwarded_from: ForwardedFrom | None = None
