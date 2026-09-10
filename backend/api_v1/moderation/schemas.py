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


class BlockStateResponse(BaseModel):
    """Текущее состояние блокировки пользователя."""

    blocked: bool


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
