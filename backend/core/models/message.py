from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .mixins import IdIntPkMixin


class Message(IdIntPkMixin, Base):
    __tablename__ = "messages"  # Явно указываем имя таблицы

    text: Mapped[str]
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id")
    )  # Изменено: users.id -> user.id
    chat_id: Mapped[int] = mapped_column(ForeignKey("chats.id"))

    # Используем строковые имена моделей для связей
    user: Mapped["User"] = relationship(back_populates="messages")  # noqa: F821
    chat: Mapped["Chat"] = relationship(back_populates="messages")  # noqa: F821
