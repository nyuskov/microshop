"""Публичный ключ устройства для сквозного шифрования (E2EE).

На устройстве генерируется пара ключей ECDH P-256 (WebCrypto). Приватный ключ
никогда не покидает браузер; на сервер загружается только публичная часть.
Для личного чата клиенты выводят общий ключ из своих приватных ключей и
публичного ключа собеседника — сервер хранит лишь шифротекст и не может
прочитать сообщения.

Упрощение Этапа 1: у каждого пользователя один «текущий» ключ устройства
(upsert по user_id). Если пользователь войдёт с другого устройства — будет
сгенерирован новый ключ, и расшифровать им старые сообщения нельзя.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class DeviceKey(Base):
    __tablename__ = "device_keys"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    # Публичный ключ (сериализованный JWK ECDH P-256), которым можно шифровать
    # сообщения для владельца этого устройства.
    public_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
