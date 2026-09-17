"""Публичный ключ устройства для сквозного шифрования (E2EE).

На устройстве генерируется пара ключей ECDH P-256 (WebCrypto). Приватный ключ
никогда не покидает браузер; на сервер загружается только публичная часть.
Для личного чата клиенты выводят общий ключ из своих приватных ключей и
публичного ключа собеседника — сервер хранит лишь шифротекст и не может
прочитать сообщения.

Один аккаунт — несколько устройств: строка идентифицируется парой
``(user_id, device_id)``. ``device_id`` генерирует клиент и хранит у себя
(localStorage), сервер только запоминает его рядом с публичным ключом. Поэтому
вход с нового устройства больше НЕ стирает ключ прежнего: прежние сообщения
остаются читаемыми, а собеседник видит все ключи и шифрует «обёртки» ключа чата
на каждое устройство (см. `api_v1/keys/views.py`).

Ключ ``legacy`` — строка, перенесённая миграцией ``c4d5e6f7a8b9`` от схемы с
одним ключом на пользователя: её пишет старый клиент, который не присылает
``device_id``.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class DeviceKey(Base):
    __tablename__ = "device_keys"
    __table_args__ = (
        # Устройство внутри аккаунта уникально: повторная загрузка ключа тем же
        # устройством обновляет строку, а не плодит дубли.
        UniqueConstraint("user_id", "device_id", name="uq_device_keys_user_device"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    #: Идентификатор устройства (генерирует клиент, хранит у себя). ``legacy`` —
    #: строка, оставшаяся от схемы «один ключ на пользователя».
    device_id: Mapped[str] = mapped_column(
        String(length=64), nullable=False, server_default="legacy"
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


__all__ = ("DeviceKey",)
