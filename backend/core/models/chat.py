from sqlalchemy.orm import Mapped, relationship

from .associations import user_chat_association_table
from .base import Base
from .mixins import IdIntPkMixin


class Chat(IdIntPkMixin, Base):
    __tablename__ = "chats"

    name: Mapped[str]

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
