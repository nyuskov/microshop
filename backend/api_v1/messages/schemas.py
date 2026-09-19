"""Pydantic-схемы сообщений."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class MessageCreate(BaseModel):
    text: str = ""
    chat_id: int
    reply_to_id: int | None = None
    #: Ответ на историю: сообщение получает плашку с превью медиа истории.
    reply_to_story_id: int | None = None
    encrypted: bool = False


class EditMessageRequest(BaseModel):
    """Новый текст сообщения (редактирование)."""

    text: str = Field(..., min_length=1, max_length=4000)


class ScheduledMessageCreate(BaseModel):
    """Отложенная отправка: текст и время, когда его отправить."""

    chat_id: int
    text: str = Field(..., min_length=1, max_length=4000)
    #: Момент отправки (UTC, с явным смещением — как `timestamp` сообщений).
    send_at: datetime
    reply_to_id: int | None = None
    encrypted: bool = False


class ScheduledMessageOut(BaseModel):
    """Отложенное сообщение для списка на клиенте."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    chat_id: int
    user_id: int
    text: str
    encrypted: bool = False
    reply_to_id: int | None = None
    send_at: datetime
    created_at: datetime


class MessageReminderCreate(BaseModel):
    """Напоминание о сообщении: когда вернуть человека к этой строке."""

    #: Момент напоминания (UTC, с явным смещением — как `timestamp` сообщений).
    remind_at: datetime


class MessageReminderOut(BaseModel):
    """Напоминание о сообщении для списка на клиенте."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    chat_id: int
    message_id: int
    #: Напоминание принадлежит автору — поле отдаём, чтобы клиент не гадал.
    user_id: int
    remind_at: datetime
    created_at: datetime


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


class ChatMediaItem(BaseModel):
    """Вложение чата для галереи медиа (без загрузки всей истории)."""

    #: id сообщения — по нему клиент открывает вложение в ленте.
    id: int
    timestamp: datetime
    url: str
    name: str
    mime: str | None = None
    size: int | None = None
    #: image / video / audio / file — группировка в интерфейсе.
    kind: str


class ReactionSummary(BaseModel):
    emoji: str
    count: int
    reacted_by_me: bool = False
    #: Кто поставил (id пользователей) — для списка «кто отреагировал». Имена
    #: клиент берёт из участников чата, чтобы не дублировать их в каждом ответе.
    user_ids: list[int] = Field(default_factory=list)


class ForwardedFrom(BaseModel):
    """Данные плашки «Переслано от …» (снимок на момент пересылки)."""

    id: int
    sender_id: int | None = None
    sender_name: str = ""
    sender_avatar_url: str | None = None
    chat_id: int | None = None


class StoryReply(BaseModel):
    """Плашка «Ответ на историю»: снимок медиа истории на момент ответа.

    Медиа хранится в самом сообщении, поэтому плашка живёт и после удаления
    истории (через сутки); ``id`` тогда становится ``None``.
    """

    id: int | None = None
    media_url: str | None = None
    mime_type: str | None = None


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
    # Скрыто модерацией: сообщение видит только автор (с пометкой), остальным
    # оно не отдаётся (см. api_v1/moderation/service.py).
    hidden: bool = False
    hidden_reason: str | None = None
    # Системная отметка о звонке.
    kind: str = "text"
    call_kind: str | None = None
    call_state: str | None = None
    call_duration: int | None = None
    call_caller_id: int | None = None
    file: MessageFile | None = None
    # Альбом: у картинок одной отправки та же метка — лента рисует их сеткой
    # (см. `utils/thread.ts::albumLayout` на клиенте).
    album_id: str | None = None
    # «Посмотреть один раз»: файл отдаётся ровно один раз (см. api_v1/media).
    view_once: bool = False
    # Одноразовое вложение уже открыли — в ленте останется плашка «Просмотрено».
    view_once_opened: bool = False
    reactions: list[ReactionSummary] = Field(default_factory=list)
    forwarded_from: ForwardedFrom | None = None
    reply_to_story: StoryReply | None = None
