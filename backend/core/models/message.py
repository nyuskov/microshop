from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .mixins import IdIntPkMixin

if TYPE_CHECKING:
    from .chat import Chat
    from .message_reaction import MessageReaction
    from .user import User


class Message(IdIntPkMixin, Base):
    __tablename__ = "messages"

    text: Mapped[str]
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        server_default=func.now(),
        index=True,
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"))
    chat_id: Mapped[int] = mapped_column(ForeignKey("chats.id"))

    # Ответ на другое сообщение (для цитат "reply")
    reply_to_id: Mapped[int | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL")
    )
    # Статус прочтения для собеседника (только для личных чатов)
    is_read: Mapped[bool] = mapped_column(
        default=False, server_default=func.false()
    )
    # Закреплено ли сообщение в чате
    is_pinned: Mapped[bool] = mapped_column(
        default=False, server_default=func.false()
    )

    # Вложение (файл/изображение)
    file_name: Mapped[str | None] = mapped_column(String(255))
    file_url: Mapped[str | None] = mapped_column(String(255))
    mime_type: Mapped[str | None] = mapped_column(String(120))
    file_size: Mapped[int | None]

    user: Mapped["User"] = relationship(back_populates="messages")
    chat: Mapped["Chat"] = relationship(back_populates="messages")
    reactions: Mapped[list["MessageReaction"]] = relationship(
        back_populates="message",
        cascade="all, delete-orphan",
    )
