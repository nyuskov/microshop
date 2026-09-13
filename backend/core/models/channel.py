"""Каналы: комментарии к постам, просмотры и предложенные подписчиками посты.

Канал — это обычный чат (`Chat`) с флагом ``is_channel``: роли участников
(``creator``/``admin``/``member`` → владелец/админ/подписчик), приглашения,
непрочитанные, вложения, реакции, пересылка и push-уведомления переиспользуются
как есть. Поэтому здесь только то, чего у чатов нет: комментарии под постами,
счётчик просмотров и «предложить пост» на одобрение.

Почему комментарии отдельной таблицей, а не ответы в ленте: в канале лента — это
только посты одного автора (подписчики писать не могут), а обсуждение живёт под
конкретным постом и не попадает в основную ленту.
"""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .mixins import IdIntPkMixin

if TYPE_CHECKING:
    from .user import User

#: Предложенный пост ждёт решения владельца/админа.
SUGGESTION_PENDING = "pending"
#: Предложенный пост опубликован в канале.
SUGGESTION_APPROVED = "approved"
#: Предложенный пост отклонён (автору приходит уведомление).
SUGGESTION_REJECTED = "rejected"


class ChannelComment(IdIntPkMixin, Base):
    """Комментарий подписчика (или админа) к посту канала."""

    __tablename__ = "channel_comments"

    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), index=True
    )
    #: Пост, под которым оставлен комментарий.
    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped["User"] = relationship("User", viewonly=True)


class ChannelPostView(IdIntPkMixin, Base):
    """Просмотр поста подписчиком (для счётчика «просмотров»).

    Строка на пару (пост, пользователь): повторные открытия не накручивают
    счётчик, а по таблице видно, кто пост видел.
    """

    __tablename__ = "channel_post_views"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="uq_channel_post_views"),
    )

    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ChannelSuggestion(IdIntPkMixin, Base):
    """Пост, предложенный подписчиком: владелец/админ одобряет или отклоняет."""

    __tablename__ = "channel_suggestions"

    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), index=True
    )
    #: Кто предложил (подписчик канала).
    author_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(Text)
    #: pending | approved | rejected (см. константы выше).
    status: Mapped[str] = mapped_column(
        String(length=16), default=SUGGESTION_PENDING, server_default=SUGGESTION_PENDING
    )
    #: Пост, который получился после одобрения (для перехода к нему).
    message_id: Mapped[int | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Кто рассмотрел предложение (владелец/админ).
    reviewed_by: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )

    author: Mapped["User"] = relationship(
        "User", viewonly=True, foreign_keys=[author_id]
    )
