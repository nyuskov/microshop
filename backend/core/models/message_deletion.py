"""Модель «сообщение скрыто у конкретного человека» («удалить у меня»).

Наличие строки ``(message_id, user_id)`` означает, что человек убрал сообщение
из своего интерфейса, но само сообщение осталось в чате для остальных: без этой
таблицы «удалить у меня» пришлось бы делать удалением строки, и оно исчезало бы
у ВСЕХ участников.

Зачем именно так: у сообщения один автор, но «убрать у себя» имеет право любой
участник — в том числе чужое сообщение. Флаг в самой строке ``messages`` для
этого не годится (он общий для всех), поэтому скрытие живёт отдельной строкой на
пару «сообщение + человек».

Читают это условие выборки в одном месте — ``core.message_visibility``: лента,
закреплённые, поиск, галерея медиа, превью списка чатов и счётчик непрочитанных.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class MessageDeletion(Base):
    __tablename__ = "message_deletions"

    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


__all__ = ("MessageDeletion",)
