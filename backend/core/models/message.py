from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .mixins import IdIntPkMixin

if TYPE_CHECKING:
    from .chat import Chat
    from .message_reaction import MessageReaction
    from .user import User


class Message(IdIntPkMixin, Base):
    __tablename__ = "messages"
    __table_args__ = (
        # Выборки истории чата и «последнего сообщения» идут по (chat_id, timestamp).
        Index("ix_messages_chat_timestamp", "chat_id", "timestamp"),
    )

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
    # Пересылка: ссылка на исходное сообщение + снимок «от кого», чтобы
    # показывать плашку «Переслано от …» даже после удаления оригинала.
    forwarded_from_id: Mapped[int | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    forwarded_sender_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    forwarded_sender_name: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
    # Снимок аватара автора оригинала (чтобы показывать его в «Переслано от …»).
    forwarded_sender_avatar_url: Mapped[str | None] = mapped_column(
        String(2048), nullable=True
    )
    forwarded_chat_id: Mapped[int | None] = mapped_column(
        ForeignKey("chats.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Статус прочтения для собеседника (только для личных чатов)
    is_read: Mapped[bool] = mapped_column(default=False, server_default=func.false())
    # Закреплено ли сообщение в чате
    is_pinned: Mapped[bool] = mapped_column(default=False, server_default=func.false())
    # Сквозное шифрование (E2EE): в text лежит шифротекст (base64), который
    # расшифровывают только клиенты собеседников. Ставится на новых текстовых
    # сообщениях в личных чатах; старые/незашифрованные остаются без флага.
    encrypted: Mapped[bool] = mapped_column(default=False, server_default=func.false())
    # Системная отметка о звонке (kind='call'): тип/исход/длительность/инициатор.
    kind: Mapped[str] = mapped_column(String(10), default="text", server_default="text")
    call_kind: Mapped[str | None] = mapped_column(String(10), nullable=True)
    call_state: Mapped[str | None] = mapped_column(String(12), nullable=True)
    call_duration: Mapped[int | None] = mapped_column(nullable=True)
    call_caller_id: Mapped[int | None] = mapped_column(nullable=True)
    # Время последнего редактирования текста (null — не редактировалось).
    edited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Скрыто модерацией (авто после N жалоб или ручным решением). Правило
    # показа: видят все, КРОМЕ автора — он получает пометку «скрыто до проверки»
    # (см. messages/crud и api_v1/moderation).
    hidden_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Почему скрыто: причина жалоб/решение модератора — показывается автору.
    hidden_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Вложение (файл/изображение)
    file_name: Mapped[str | None] = mapped_column(String(255))
    file_url: Mapped[str | None] = mapped_column(String(255))
    mime_type: Mapped[str | None] = mapped_column(String(120))
    file_size: Mapped[int | None]

    user: Mapped["User"] = relationship(
        back_populates="messages",
        # У Message два FK на user (автор + автор пересылки) — уточняем связь.
        foreign_keys="Message.user_id",
    )
    chat: Mapped["Chat"] = relationship(
        back_populates="messages",
        # У Message два FK на chats (чат + исходный чат пересылки).
        foreign_keys="Message.chat_id",
    )
    reactions: Mapped[list["MessageReaction"]] = relationship(
        back_populates="message",
        cascade="all, delete-orphan",
    )
