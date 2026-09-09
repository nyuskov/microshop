"""Pydantic-схемы чатов."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from api_v1.messages.schemas import Message as MessageSchema


class PrivateChatCreate(BaseModel):
    user_id: int


class ChatUserSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    first_name: str | None = None
    last_name: str | None = None
    phone_number: str | None = None
    avatar_url: str | None = None
    status: str | None = None
    last_seen: datetime | None = None


class Chat(BaseModel):
    id: int
    name: str
    users: list[ChatUserSchema] = []
    last_message: MessageSchema | None = None
    unread_count: int = 0
    # Замьючен ли чат для текущего пользователя (без уведомлений).
    muted: bool = False
    # Тип чата: True — «зашифрованный» (E2EE), False — «обычный». По умолчанию обычный.
    e2ee_enabled: bool = False
    # «Сохранённые сообщения» (личный чат с собой).
    is_self: bool = False


class ChatE2eeUpdate(BaseModel):
    """Переключение типа чата (обычный/зашифрованный)."""

    enabled: bool
