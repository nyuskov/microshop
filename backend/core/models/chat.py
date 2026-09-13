from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .associations import user_chat_association_table
from .base import Base
from .mixins import IdIntPkMixin

if TYPE_CHECKING:
    from .chat_invite import ChatInvite
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
    # Групповой чат: True — общий чат многих участников (роли, добавление/
    # исключение участников); False — личный (парный) чат или «Сохранённые».
    is_group: Mapped[bool] = mapped_column(default=False, server_default=func.false())
    # Канал: подписчики читают посты одного автора и не могут писать в ленту
    # (см. `api_v1/channels`). Канал — это тот же чат: роли, приглашения,
    # непрочитанные, вложения и push переиспользуются. Посты — обычные сообщения.
    is_channel: Mapped[bool] = mapped_column(default=False, server_default=func.false())
    # Публичный адрес канала: `https://pismo.space/c/<channel_username>`.
    # None — приватный канал (вход только по ссылке-приглашению).
    channel_username: Mapped[str | None] = mapped_column(
        String(length=32), nullable=True, unique=True, server_default=None
    )
    # Публичный канал виден в поиске и открывается по адресу выше.
    is_public: Mapped[bool] = mapped_column(default=False, server_default=func.false())
    # Аватар группового чата (путь /media/...); у личных чатов не заполняется.
    avatar_url: Mapped[str | None] = mapped_column(nullable=True, server_default=None)
    # Маленькая копия аватара для списков и шапок (128px).
    # None — показываем оригинал (старые аватары).
    avatar_thumb_url: Mapped[str | None] = mapped_column(
        nullable=True, server_default=None
    )
    # Описание группы (видно в карточке чата).
    description: Mapped[str | None] = mapped_column(nullable=True)
    # Создатель группового чата (не null для групп). Удаляется (SET NULL), если
    # аккаунт создателя удалили, — группа при этом продолжает жить.
    creator_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )

    users: Mapped[list["User"]] = relationship(
        "User",
        secondary=user_chat_association_table,
        primaryjoin="Chat.id == chat_user_association.c.chat_id",
        secondaryjoin="User.id == chat_user_association.c.user_id",
        back_populates="chats",
    )

    creator: Mapped["User | None"] = relationship(
        "User",
        primaryjoin="Chat.creator_id == User.id",
        foreign_keys="Chat.creator_id",
        viewonly=True,
    )

    # Ссылки-приглашения группы (см. `ChatInvite`).
    invites: Mapped[list["ChatInvite"]] = relationship(
        "ChatInvite", back_populates="chat", cascade="all, delete-orphan"
    )

    messages: Mapped[list["Message"]] = relationship(
        "Message",
        primaryjoin="Chat.id == Message.chat_id",
        back_populates="chat",
    )


__all__ = ("Chat", "user_chat_association_table")
