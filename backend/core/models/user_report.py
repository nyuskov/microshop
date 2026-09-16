"""Жалоба на пользователя/сообщение (требование RuStore к приложениям с UGC).

RuStore требует, чтобы у пользователя был механизм сообщить о неприемлемом
контенте; жалобы складываются в эту таблицу и разбираются модераторами через
служебные эндпоинты ``GET/PATCH /api/v1/moderation/reports/`` (только
``is_superuser``). При удалении аккаунта жалобы, отправленные и полученные им,
удаляются вместе с ним.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from core.db_types import EncryptedText

from .base import Base

# Допустимые причины жалобы (значения приходят с клиента).
REPORT_REASONS = (
    "spam",
    "abuse",
    "fraud",
    "violence",
    "other",
)

# Статусы разбора жалобы: новая → в работе → решено/отклонено.
REPORT_STATUSES = (
    "new",
    "in_review",
    "resolved",
    "rejected",
)


class UserReport(Base):
    __tablename__ = "user_reports"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    reporter_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), index=True, nullable=False
    )
    reported_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Контекст жалобы (может быть не указан, если жалоба на пользователя целиком).
    chat_id: Mapped[int | None] = mapped_column(
        ForeignKey("chats.id", ondelete="SET NULL"), nullable=True
    )
    message_id: Mapped[int | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    # Код причины (см. REPORT_REASONS) и свободный комментарий.
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    comment: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    # Статус разбора: new / in_review / resolved / rejected (см. REPORT_STATUSES).
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'new")
    )
    # Заметка модератора по итогам разбора (что сделали).
    note: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Когда жалобу перестали считать новой (для отчёта по срокам реакции).
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
