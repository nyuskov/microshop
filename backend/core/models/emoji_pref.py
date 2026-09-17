"""Выбор паков эмодзи и избранные эмодзи — на аккаунт, а не на устройство.

Почему на сервере: выбор должен переезжать между устройствами. Человек отметил
паки на телефоне — и хочет видеть их на ноутбуке (в приложении уже есть
настройки, которые так не умеют: например, устройства звонка хранятся в
localStorage, и это нормально — они свойство устройства, а не человека).

Сами паки в базе НЕ хранятся: это наборы Unicode-эмодзи, они живут в клиенте
(``frontend/src/utils/emojiPacks.ts``) и меняются вместе с релизом приложения.
Сервер держит только ключи: какие паки включены и сколько их, плюс «Мои» —
эмодзи, которые человек добавил себе отдельно.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class EmojiPackChoice(Base):
    """Включённый пак эмодзи: ``position`` задаёт порядок вкладок в панели."""

    __tablename__ = "emoji_pack_choices"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    #: Ключ пака из каталога клиента (например, ``smileys``).
    pack_key: Mapped[str] = mapped_column(String(40), primary_key=True)
    position: Mapped[int] = mapped_column(default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class EmojiFavorite(Base):
    """Эмодзи в «Моих».

    Ключ — сама последовательность: флаг (🇷🇺) или семья с ZWJ (👨‍👩‍👧) занимают
    до ~11 кодовых точек, поэтому 64 символа с запасом.
    """

    __tablename__ = "emoji_favorites"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    emoji: Mapped[str] = mapped_column(String(64), primary_key=True)
    position: Mapped[int] = mapped_column(default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


__all__ = ("EmojiFavorite", "EmojiPackChoice")
