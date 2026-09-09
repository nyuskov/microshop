from typing import TYPE_CHECKING

from sqlalchemy import func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .associations import user_chat_association_table
from .base import Base
from .mixins import IdIntPkMixin

if TYPE_CHECKING:
    from .message import Message
    from .user import User


class Chat(IdIntPkMixin, Base):
    __tablename__ = "chats"

    name: Mapped[str]

    # Тип чата: False — «обычный» (сервер хранит текст как есть → текст виден в
    # превью и уведомлениях); True — «зашифрованный» (E2EE: в text лежит только
    # шифротекст, сервер его не читает). По умолчанию обычный.
    e2ee_enabled: Mapped[bool] = mapped_column(
        default=False, server_default=func.false()
    )
    # «Сохранённые сообщения» — личный чат с собой; нельзя удалить.
    is_self: Mapped[bool] = mapped_column(default=False, server_default=func.false())

    users: Mapped[list["User"]] = relationship(
        "User",
        secondary=user_chat_association_table,
        primaryjoin="Chat.id == chat_user_association.c.chat_id",
        secondaryjoin="User.id == chat_user_association.c.user_id",
        back_populates="chats",
    )

    messages: Mapped[list["Message"]] = relationship(
        "Message",
        primaryjoin="Chat.id == Message.chat_id",
        back_populates="chat",
    )


__all__ = ("Chat", "user_chat_association_table")
