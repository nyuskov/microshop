from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from .mixins import IdIntPkMixin

if TYPE_CHECKING:
    pass


class MessageReminder(IdIntPkMixin, Base):
    """«Напомнить мне» о конкретном сообщении.

    Отличие от отложенного сообщения (``ScheduledMessage``): там мы пишем новое
    сообщение в будущем, здесь — просим вернуть СЕБЯ к уже отправленному. Поэтому
    хранится только ссылка на сообщение и время, а текст не дублируется: он
    может быть изменён или удалён, напоминание всё равно должно сработать.

    Живёт на сервере, а не таймером в браузере: напоминание должно приходить и с
    закрытым приложением. Очередь разбирает Celery beat раз в минуту
    (см. ``tasks/scheduled_tasks.py``), доставку делает push
    (``tasks.notifications.send_reminder_push``).
    """

    __tablename__ = "message_reminders"
    __table_args__ = (
        # Разбор очереди идёт по времени, список в чате — по паре «человек + чат».
        Index("ix_message_reminders_remind_at", "remind_at"),
        Index("ix_message_reminders_user_chat", "user_id", "chat_id"),
        # На сообщение — одно напоминание у человека: повторная постановка
        # переносит срок, а не копит «будильники» на одну строку.
        UniqueConstraint(
            "user_id", "message_id", name="uq_message_reminders_user_message"
        ),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    #: Сообщение, о котором напоминаем. Удалят сообщение — уйдёт и напоминание
    #: (индекс «по чему напоминать» без самого сообщения не нужен).
    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), nullable=False
    )
    #: Когда напомнить (UTC, без смещения — как времена сообщений).
    remind_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )
