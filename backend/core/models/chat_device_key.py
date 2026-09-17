"""Обёртки ключа чата на каждое устройство участника (E2EE, A5).

Личный чат раньше шифровался ключом, выведенным из общего секрета ECDH двух
«текущих» ключей аккаунтов. У аккаунта с двумя устройствами «текущий» ключ
один, поэтому второе устройство читать новые сообщения не могло: секрет
считался с чужим публичным ключом, а приватный ключ устройства есть только у
него.

Теперь личный чат может шифроваться СИММЕТРИЧНЫМ ключом чата (как группы):
он хранится только у клиентов, а сервер держит «обёртки» — ключ чата,
зашифрованный на общем секрете ECDH между устройством-раздатчиком
(``wrapped_by_user_id`` + ``wrapped_by_device_id``) и устройством-получателем.
Получатель открывает обёртку своим приватным ключом и публичным ключом
раздатчика — сервер видит только шифротекст.

Ключ ``device_id`` — из `core/models/device_key.py`; строки ``legacy``
обслуживают старые устройства, которые идентификатор ещё не присылают.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ChatDeviceKey(Base):
    __tablename__ = "chat_device_keys"
    __table_args__ = (
        # Ротация ключа чата удаляет и переписывает все обёртки разом, поэтому
        # по chat_id нужен отдельный индекс (первичный ключ начинается с него
        # же, но FK-удаление чата идёт именно по этому столбцу).
        Index("ix_chat_device_keys_chat_id", "chat_id"),
    )

    chat_id: Mapped[int] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    #: Устройство-получатель (``legacy`` — старое устройство без идентификатора).
    device_id: Mapped[str] = mapped_column(String(length=64), primary_key=True)
    # Ключ чата, зашифрованный для этого устройства (payload ``e2ee1:<iv>:<ct>``).
    wrapped_key: Mapped[str] = mapped_column(Text, nullable=False)
    # Кто раздал обёртку: его устройство знает тот же общий секрет, поэтому
    # получателю нужны оба идентификатора, чтобы повторить ECDH.
    # SET NULL: аккаунт-раздатчик мог быть удалён — обёртка остаётся, но
    # открыть её получится, пока известен публичный ключ раздатчика.
    wrapped_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    wrapped_by_device_id: Mapped[str | None] = mapped_column(
        String(length=64), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


__all__ = ("ChatDeviceKey",)
