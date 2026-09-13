"""Схемы API каналов."""

from datetime import datetime

from pydantic import BaseModel, Field


class ChannelCreate(BaseModel):
    """Создание канала."""

    title: str = Field(min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=512)
    #: Публичный канал: адрес `/c/<username>` и поиск. Приватный — только ссылка.
    is_public: bool = False
    username: str | None = Field(default=None, max_length=32)


class ChannelUpdate(BaseModel):
    """Правка канала (владелец/админ): все поля необязательны."""

    title: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=512)
    is_public: bool | None = None
    username: str | None = Field(default=None, max_length=32)


class ChannelCard(BaseModel):
    """Карточка канала для списка/поиска/превью."""

    id: int
    title: str
    description: str | None = None
    username: str | None = None
    is_public: bool = False
    avatar_url: str | None = None
    avatar_thumb_url: str | None = None
    #: Сколько подписчиков (включая владельца и админов).
    subscribers: int = 0
    #: Сколько постов опубликовано.
    posts: int = 0
    #: Моя роль: creator/admin/member или None (не подписан).
    role: str | None = None
    #: Кто владелец — имя для карточки подписки.
    owner_name: str | None = None


class AdminChange(BaseModel):
    """Назначить/снять админа (только владелец)."""

    user_id: int
    admin: bool = True


class SubscriberOut(BaseModel):
    id: int
    username: str
    name: str
    avatar_url: str | None = None
    role: str
    #: Подписан ли он на канал (у канала все участники — подписчики).
    joined_at: datetime | None = None


class CommentCreate(BaseModel):
    text: str = Field(min_length=1, max_length=4096)


class CommentOut(BaseModel):
    id: int
    message_id: int
    user_id: int
    name: str
    username: str
    avatar_url: str | None = None
    text: str
    created_at: datetime
    #: Мой комментарий (можно удалить) или я владелец/админ канала.
    can_delete: bool = False


class SuggestionCreate(BaseModel):
    text: str = Field(min_length=1, max_length=4096)


class SuggestionOut(BaseModel):
    id: int
    chat_id: int
    author_id: int
    author_name: str
    text: str
    status: str
    message_id: int | None = None
    created_at: datetime


class PostMeta(BaseModel):
    """Счётчики поста: просмотры и комментарии."""

    message_id: int
    views: int = 0
    comments: int = 0
