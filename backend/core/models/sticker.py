"""Стикеры пользователя: наборы (паки) и картинки в них.

Зачем отдельные таблицы, а не «файлы в сообщениях»: стикер должен быть
переиспользуемым — человек добавляет картинку один раз и отправляет сколько
угодно раз, выбирая её из панели. Само отправленное сообщение при этом остаётся
обычным вложением, только с ``kind='sticker'``: история чата, пересылка,
удаление, непрочитанные и квота работают без специальных веток.

Паки (а не один плоский список) нужны для порядка: у них есть название и
позиция, стикеры внутри тоже упорядочены — как в Telegram.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .mixins import IdIntPkMixin


class StickerPack(IdIntPkMixin, Base):
    """Набор стикеров одного человека."""

    __tablename__ = "sticker_packs"
    __table_args__ = (
        # Список паков всегда берётся по владельцу и показывается по порядку.
        Index("ix_sticker_packs_owner_position", "owner_id", "position"),
    )

    owner_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(60))
    position: Mapped[int] = mapped_column(default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    stickers: Mapped[list["Sticker"]] = relationship(
        back_populates="pack",
        cascade="all, delete-orphan",
        order_by="Sticker.position",
    )


class Sticker(IdIntPkMixin, Base):
    """Картинка-стикер внутри набора.

    Файл лежит в ``media/`` и отдаётся через ``/media/<name>`` — так же, как
    вложения и аватары (см. ``core/media_store.py``: на диске всё зашифровано
    ключом сервера, наружу отдаётся через ``api_v1/media``).
    """

    __tablename__ = "stickers"
    __table_args__ = (Index("ix_stickers_pack_position", "pack_id", "position"),)

    pack_id: Mapped[int] = mapped_column(
        ForeignKey("sticker_packs.id", ondelete="CASCADE")
    )
    file_url: Mapped[str] = mapped_column(String(255))
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    file_size: Mapped[int | None] = mapped_column(nullable=True)
    position: Mapped[int] = mapped_column(default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    pack: Mapped["StickerPack"] = relationship(back_populates="stickers")


__all__ = ("Sticker", "StickerPack")
