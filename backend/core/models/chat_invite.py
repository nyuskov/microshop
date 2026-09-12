"""Ссылка-приглашение в группу.

Ссылка даёт вход в группу без добавления «руками»: создатель или админ делает
её в карточке группы, отправляет другу любым способом (мессенджер, почта), а
тот открывает и присоединяется.

Ссылку можно ограничить по времени и по числу входов, а также отозвать
(``revoked``) — тогда она сразу перестаёт работать, хотя строка остаётся в БД:
так видно, кто и когда её создал (журнал модерации/аудит группы).

Токен — случайная строка (``secrets.token_urlsafe``), угадать соседнюю ссылку
нельзя. В БД храним именно токен: он и есть секрет ссылки.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class ChatInvite(Base):
    __tablename__ = "chat_invites"

    id: Mapped[int] = mapped_column(primary_key=True)

    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), index=True
    )
    #: Секрет ссылки: `/j/<token>`. Уникален во всей таблице.
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)

    #: Кто создал ссылку (NULL — аккаунт удалён, ссылка при этом живёт).
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    #: Необязательный срок годности и лимит входов (NULL — без ограничения).
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Сколько раз по ссылке уже вошли (считаем только новые участия).
    uses: Mapped[int] = mapped_column(Integer, server_default="0")
    #: Отозванная ссылка не работает, но остаётся в списке истории.
    revoked: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )

    chat = relationship("Chat", back_populates="invites")


__all__ = ("ChatInvite",)
