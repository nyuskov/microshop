"""Схемы модерации: жалобы и блокировки."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# Причины жалобы: коды, которые видит модератор (и совпадают с REPORT_REASONS).
ReportReason = Literal["spam", "abuse", "fraud", "violence", "other"]

# Статусы разбора жалобы (см. core.models.user_report.REPORT_STATUSES).
ReportStatus = Literal["new", "in_review", "resolved", "rejected"]


class ReportCreateRequest(BaseModel):
    """Жалоба на пользователя (опционально — на конкретное сообщение)."""

    user_id: int = Field(gt=0)
    reason: ReportReason
    comment: str | None = Field(default=None, max_length=1000)
    chat_id: int | None = Field(default=None, gt=0)
    message_id: int | None = Field(default=None, gt=0)


class ReportResponse(BaseModel):
    """Ответ на создание жалобы."""

    id: int
    status: str


class BlockRequest(BaseModel):
    """Вид блокировки при постановке.

    По умолчанию — полная (сообщения и звонки запрещены, чат скрыт).
    ``messages_allowed=True`` — «только звонки»: переписка остаётся.
    """

    messages_allowed: bool = False


class BlockStateResponse(BaseModel):
    """Текущее состояние блокировки пользователя."""

    blocked: bool
    #: True — это мягкая блокировка («только звонки»), сообщения проходят.
    messages_allowed: bool = False


class BlockedUserItem(BaseModel):
    """Заблокированный пользователь в списке (с видом блокировки)."""

    id: int
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    avatar_url: str | None = None
    avatar_thumb_url: str | None = None
    #: True — сообщения от него проходят, запрещены только звонки.
    messages_allowed: bool = False


class ReportItem(BaseModel):
    """Жалоба для экрана модератора (кто → на кого, причина, контекст)."""

    id: int
    reporter_id: int
    reporter_name: str | None = None
    reporter_phone: str | None = None
    reported_id: int
    reported_name: str | None = None
    reported_phone: str | None = None
    reason: str
    comment: str | None = None
    chat_id: int | None = None
    message_id: int | None = None
    # Текст сообщения, на которое пожаловались (обрезан, если длинный).
    message_text: str | None = None
    status: str
    note: str | None = None
    created_at: datetime
    reviewed_at: datetime | None = None


class ReportListResponse(BaseModel):
    """Постраничный список жалоб (total — сколько всего подходит под фильтр)."""

    total: int
    items: list[ReportItem]


class ReportUpdateRequest(BaseModel):
    """Смена статуса разбора (+ заметка модератора)."""

    status: ReportStatus
    note: str | None = Field(default=None, max_length=1000)


class JournalItemSchema(BaseModel):
    """Одна запись журнала модерации."""

    id: int
    action: str
    # NULL = действие автоматики (авто-скрытие по жалобам).
    moderator_id: int | None = None
    target_user_id: int | None = None
    report_id: int | None = None
    message_id: int | None = None
    note: str = ""
    created_at: datetime


class JournalResponse(BaseModel):
    """Журнал модерации + сколько сообщений скрыто сейчас."""

    total: int
    hidden_messages: int = 0
    items: list[JournalItemSchema]


class UnhideResponse(BaseModel):
    """Сколько сообщений вернули в чаты."""

    restored: int = 0
