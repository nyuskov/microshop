"""Обёртка ключа группы для участника — сквозное шифрование групповых чатов.

Групповой чат шифруется симметричным ключом (32 случайных байта), который
знают только участники: он никогда не уходит на сервер в открытом виде. Вместо
этого каждый участник получает персональную «обёртку» — ключ группы,
зашифрованный на общем секрете ECDH между тем, кто раздал ключ
(``wrapped_by``), и получателем. Расшифровать обёртку может только получатель
(его приватный ключ устройства) — сервер видит лишь шифротекст.

При изменении состава группы ключ ротируется: старые обёртки заменяются на
обёртки нового ключа (``PUT /keys/group/{chat_id}/`` с ``replace=true``),
поэтому исключённый участник не может прочитать новые сообщения — у него
остался только прежний ключ.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ChatGroupKey(Base):
    __tablename__ = "chat_group_keys"
    __table_args__ = (
        # Выборки идут парой (chat_id, user_id) — это и есть первичный ключ,
        # а отдельный индекс по chat_id нужен для ротации (замена всех обёрток).
        Index("ix_chat_group_keys_chat_id", "chat_id"),
    )

    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    # Ключ группы, зашифрованный для этого участника (payload вида
    # ``e2ee1:<iv_b64>:<ct_b64>``). Приватный ключ устройства — только у клиента.
    wrapped_key: Mapped[str] = mapped_column(Text, nullable=False)
    # Кто раздал обёртку (его публичный ключ нужен получателю для ECDH).
    # SET NULL: если раздавший удалил аккаунт, обёртка остаётся, но получатель
    # сможет расшифровать её только до тех пор, пока знает его публичный ключ.
    wrapped_by: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


__all__ = ("ChatGroupKey",)
