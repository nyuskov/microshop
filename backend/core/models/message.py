from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.db_types import EncryptedText

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

    # Текст сообщения хранится зашифрованным ключом сервера (at-rest), а по
    # колонке нельзя искать SQL-ом — поиск идёт в приложении
    # (см. messages.crud.search_messages).
    text: Mapped[str] = mapped_column(EncryptedText)
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

    # Ответ на историю: ссылка на неё (история истекает и удаляется — тогда
    # ссылка обнуляется, сообщение остаётся) и снимок медиа для плашки
    # «Ответ на историю» в переписке. Снимок рядом, а не через join: плашка
    # должна работать и после удаления истории — приём тот же, что у
    # пересланных сообщений (forwarded_sender_*).
    reply_to_story_id: Mapped[int | None] = mapped_column(
        ForeignKey("stories.id", ondelete="SET NULL"), nullable=True
    )
    reply_to_story_media_url: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
    reply_to_story_mime_type: Mapped[str | None] = mapped_column(
        String(120), nullable=True
    )

    # Вложение (файл/изображение)
    file_name: Mapped[str | None] = mapped_column(String(255))
    file_url: Mapped[str | None] = mapped_column(String(255))
    mime_type: Mapped[str | None] = mapped_column(String(120))
    file_size: Mapped[int | None]

    # Альбом: картинки, отправленные одним действием, делят один `album_id` и
    # рисуются в ленте одной сеткой. Сервер хранит только метку — группировка
    # клиентская (см. api_v1/messages/crud.send_attachment_message).
    album_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)

    # «Посмотреть один раз»: файл отдаётся ровно один раз, дальше сервер его не
    # показывает (см. api_v1/media/views.py — там же удаление блоба).
    view_once: Mapped[bool] = mapped_column(
        default=False, server_default=func.false(), nullable=False
    )
    # Когда вложение открыли (null — ещё не открывали).
    view_once_opened_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=False), nullable=True
    )

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
