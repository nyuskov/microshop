"""Схемы API историй (лента, элемент, публикация)."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class StoryAuthor(BaseModel):
    """Автор истории — минимальные данные для аватарки и подписи."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    first_name: str | None = None
    last_name: str | None = None
    avatar_url: str | None = None


class StoryItem(BaseModel):
    """Одна история в ленте."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    media_url: str
    media_name: str | None = None
    mime_type: str | None = None
    caption: str | None = None
    created_at: datetime
    expires_at: datetime
    #: Я уже посмотрел эту историю (для своих — есть ли чужие просмотры).
    viewed: bool = False
    #: Сколько раз смотрели (полезно автору).
    views: int = 0


class StoryGroup(BaseModel):
    """Истории одного автора (в ленте — по одной группе на человека)."""

    user: StoryAuthor
    items: list[StoryItem]
    #: Есть ли в группе непросмотренные (для точки на аватарке).
    has_unseen: bool
    #: Это мои истории (можно удалять).
    is_mine: bool


class StoryFeed(BaseModel):
    """Ответ ленты: мои истории сверху, далее остальные."""

    groups: list[StoryGroup]


class StoryUpdate(BaseModel):
    """Правка подписи своей истории."""

    caption: str | None = Field(default=None, max_length=255)
