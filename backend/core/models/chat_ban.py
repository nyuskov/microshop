from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .mixins import IdIntPkMixin

if TYPE_CHECKING:
    from .user import User


class ChatBan(IdIntPkMixin, Base):
    """Бан участника в группе.

    Зачем отдельная таблица, если есть исключение из чата: исключённый может
    вернуться по той же ссылке-приглашению (или его снова добавит админ). Бан
    закрывает вход: по нему не пускаем ни добавление, ни вход по ссылке, снимает
    его только админ/создатель.

    Личные чаты бан не используют (там есть блокировки пользователей), поэтому
    записи появляются только для групп и каналов.
    """

    __tablename__ = "chat_bans"
    __table_args__ = (
        # Один бан на пару «чат + человек»: повторный бан обновляет причину и
        # автора, а не плодит строки.
        UniqueConstraint("chat_id", "user_id", name="uq_chat_bans_chat_user"),
    )

    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    # Кто забанил (удаление аккаунта автора бан не снимает — SET NULL).
    banned_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    # Причина для списка банов (необязательная, только для админов).
    reason: Mapped[str | None] = mapped_column(String(length=200), nullable=True)
    banned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )

    user: Mapped["User"] = relationship(
        "User", primaryjoin="ChatBan.user_id == User.id", foreign_keys=[user_id]
    )
