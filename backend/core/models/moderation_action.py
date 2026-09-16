"""Журнал модерации: кто, когда и что сделал с контентом.

Зачем: RuStore (и любой магазин с UGC) требует не только «кнопку пожаловаться»,
но и разбор жалоб с прослеживаемостью. Раньше статус жалобы менялся без следа —
в БД оставался только текущий статус, и на вопрос «почему контент скрыт» ответить
было нечем.

Записи пишутся и на действия автомата (``moderator_id = None``): авто-скрытие по
жалобам, авто-восстановление. Журнал append-only: существующие записи не меняются,
поэтому его можно показывать в спорах и выгрузках.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from core.db_types import EncryptedText

from .base import Base

# Действия автомата (moderator_id = NULL).
ACTION_REPORT_CREATED = "report_created"
ACTION_MESSAGE_AUTO_HIDDEN = "message_auto_hidden"
# Действия модератора.
ACTION_REPORT_STATUS_CHANGED = "report_status_changed"
ACTION_MESSAGE_HIDDEN = "message_hidden"
ACTION_MESSAGE_RESTORED = "message_restored"
# Спасение угнанного аккаунта по обращению владельца (поддержка).
ACTION_SESSIONS_REVOKED = "sessions_revoked"
ACTION_ACCOUNT_FROZEN = "account_frozen"
ACTION_ACCOUNT_UNFROZEN = "account_unfrozen"

MODERATION_ACTIONS = frozenset(
    {
        ACTION_REPORT_CREATED,
        ACTION_MESSAGE_AUTO_HIDDEN,
        ACTION_REPORT_STATUS_CHANGED,
        ACTION_MESSAGE_HIDDEN,
        ACTION_MESSAGE_RESTORED,
        ACTION_SESSIONS_REVOKED,
        ACTION_ACCOUNT_FROZEN,
        ACTION_ACCOUNT_UNFROZEN,
    }
)


class ModerationAction(Base):
    """Одна запись журнала модерации (append-only)."""

    __tablename__ = "moderation_actions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Кто выполнил: NULL = автоматика (см. ACTION_*), иначе пользователь.
    moderator_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Кого касается действие (автор контента/заявитель).
    target_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Ссылки на объекты действия (могут пропасть — тогда остаётся текст заметки).
    report_id: Mapped[int | None] = mapped_column(
        ForeignKey("user_reports.id", ondelete="SET NULL"), nullable=True, index=True
    )
    message_id: Mapped[int | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(40), index=True)
    # Человекочитаемое пояснение: причина жалости/решение модератора/повод.
    # В заметке цитируется пользовательский текст, поэтому она тоже шифруется.
    note: Mapped[str] = mapped_column(EncryptedText, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
