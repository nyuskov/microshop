from datetime import datetime
from typing import TYPE_CHECKING

from fastapi_users.db import SQLAlchemyBaseUserTable
from sqlalchemy import BigInteger, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .associations import user_chat_association_table
from .base import Base
from .mixins import IdIntPkMixin

if TYPE_CHECKING:
    from .chat import Chat
    from .message import Message
    from .profile import Profile


class User(IdIntPkMixin, SQLAlchemyBaseUserTable[int], Base):
    __tablename__ = "user"

    username: Mapped[str] = mapped_column(String(32), unique=True)
    phone_number: Mapped[str] = mapped_column(String(20), unique=True, nullable=True)
    first_name: Mapped[str] = mapped_column(String(32), nullable=True)
    last_name: Mapped[str] = mapped_column(String(32), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    # email может отсутствовать при входе по телефону, поэтому nullable
    email: Mapped[str | None] = mapped_column(  # type: ignore[assignment]
        String(length=320), nullable=True
    )
    avatar_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Текст-статус пользователя (например «в работе», «🚀»), задаётся в профиле.
    status: Mapped[str | None] = mapped_column(String(140), nullable=True)
    # Время последней активности — для присутствия («в сети» / «был(а) N назад»).
    last_seen: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # ID Telegram-чата с нашим ботом (привязка) — для доставки OTP в личку,
    # когда Telegram Gateway недоступен/не настроен.
    tg_chat_id: Mapped[int | None] = mapped_column(
        BigInteger, unique=True, nullable=True
    )

    profile: Mapped["Profile"] = relationship(back_populates="user")

    chats: Mapped[list["Chat"]] = relationship(
        "Chat",
        secondary=user_chat_association_table,
        primaryjoin="User.id == chat_user_association.c.user_id",
        secondaryjoin="Chat.id == chat_user_association.c.chat_id",
        back_populates="users",
    )

    messages: Mapped[list["Message"]] = relationship(
        "Message",
        primaryjoin="User.id == Message.user_id",
        back_populates="user",
    )

    def __str__(self):
        return f"{self.__class__.__name__}(id={self.id}, username={self.username!r})"

    def __repr__(self):
        return str(self)
