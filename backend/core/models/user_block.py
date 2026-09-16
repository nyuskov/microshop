"""Блокировка пользователя (требование RuStore к приложениям с UGC).

Блокирующий (``blocker_id``) не получает сообщения и push от заблокированного
(``blocked_id``), чат с ним скрывается из списка диалогов, а заблокированный не
может отправлять блокирующему сообщения (запрет действует в обе стороны, чтобы
блокировка действительно работала).

Действует для личных чатов 1-1; на группы не распространяется.

Блокировка бывает двух видов (``messages_allowed``):

* ``False`` (по умолчанию) — полная: ни сообщений, ни звонков, чат скрыт;
* ``True`` — «только звонки»: переписка идёт как обычно, чат на месте, но
  дозвониться нельзя. Нужно это чаще, чем полная блокировка: человек не хочет
  ночных звонков от знакомого, но не собирается вычёркивать его из переписки.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class UserBlock(Base):
    __tablename__ = "user_blocks"
    __table_args__ = (
        UniqueConstraint("blocker_id", "blocked_id", name="uq_user_blocks_pair"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # Кто заблокировал.
    blocker_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Кого заблокировали.
    blocked_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Разрешить сообщения (тогда запрет касается только звонков).
    messages_allowed: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
