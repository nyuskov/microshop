from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from core.db_types import EncryptedText

from .base import Base
from .mixins import IdIntPkMixin

if TYPE_CHECKING:
    pass


class ScheduledMessage(IdIntPkMixin, Base):
    """Отложенное сообщение: текст, который уйдёт в чат в назначенное время.

    Почему на сервере, а не таймером в браузере: «отправить утром» должно
    сработать и с закрытым приложением. Очередь разбирает Celery beat раз в
    минуту (см. ``tasks/scheduled_tasks.py``).

    Хранится только текст: вложение пришлось бы держать на диске до отправки, а
    это уже отдельная задача (файл мог бы стать «сиротой», если пользователь
    отменит отправку).
    """

    __tablename__ = "scheduled_messages"
    __table_args__ = (
        # Разбор очереди идёт по времени отправки, список в чате — по паре
        # «чат + время»: индексы под оба запроса.
        Index("ix_scheduled_messages_send_at", "send_at"),
        Index("ix_scheduled_messages_chat_user", "chat_id", "user_id"),
    )

    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    #: Текст сообщения (шифруется «в покое» так же, как обычные сообщения).
    text: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    #: Чат зашифрован (E2EE): в тексте лежит шифротекст клиента.
    encrypted: Mapped[bool] = mapped_column(
        default=False, server_default=func.false(), nullable=False
    )
    #: Куда ответить при отправке (id сообщения; может исчезнуть до срока).
    reply_to_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Когда отправить (UTC, без смещения — как остальные времена сообщений).
    send_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )
