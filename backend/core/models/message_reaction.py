from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .message import Message


class MessageReaction(Base):
    """Реакция (эмодзи) пользователя на сообщение."""

    __tablename__ = "message_reactions"

    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    emoji: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )

    message: Mapped["Message"] = relationship(back_populates="reactions")

    def __str__(self) -> str:
        return (
            f"{self.__class__.__name__}(message_id={self.message_id}, "
            f"user_id={self.user_id}, emoji={self.emoji!r})"
        )

    def __repr__(self) -> str:
        return str(self)


__all__ = ("MessageReaction",)
