"""Схемы API историй (лента, элемент, публикация, реакции)."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class StoryReactionSummary(BaseModel):
    """Сводка по одному эмодзи: сколько человек поставили и моя ли это реакция.

    Кто именно отреагировал — не отдаём: это лишние данные в каждой ленте, а
    список отреагировавших — отдельная задача (как и список просмотревших).
    """

    emoji: str
    count: int
    #: true — эту реакцию поставил текущий зритель (рисуем её выделенной).
    mine: bool = False


class StoryReactionIn(BaseModel):
    """Запрос на реакцию: одно эмодзи из набора сервера."""

    emoji: str = Field(min_length=1, max_length=16)


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
    #: Реакции на историю, сгруппированные по эмодзи (сначала популярные).
    reactions: list[StoryReactionSummary] = Field(default_factory=list)


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
    #: Набор допустимых реакций. Отдаём сервером, чтобы панель на клиенте и
    #: валидация в API не разъезжались, если набор поправят.
    reaction_kinds: list[str] = Field(default_factory=list)
    #: Сколько кнопок показывать сразу, остальные — под «ещё».
    reactions_primary: int = 0


class StoryUpdate(BaseModel):
    """Правка подписи своей истории."""

    caption: str | None = Field(default=None, max_length=255)


class StoryReactionAudience(BaseModel):
    """Кто поставил конкретный эмодзи (видит только автор истории)."""

    emoji: str
    users: list[StoryAuthor] = Field(default_factory=list)


class StoryAudience(BaseModel):
    """Аудитория своей истории: просмотры и реакции по эмодзи.

    Отдаётся только автору и только по его истории: список просмотревших — это
    персональные данные зрителей, другим их видеть незачем.
    """

    #: Кто смотрел (свежие просмотры впереди).
    views: list[StoryAuthor] = Field(default_factory=list)
    #: Всего просмотров (может быть больше, чем показанных в списке).
    views_total: int = 0
    #: Реакции, сгруппированные по эмодзи (популярные впереди).
    reactions: list[StoryReactionAudience] = Field(default_factory=list)
