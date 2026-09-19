"""Схемы API стикеров."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from core.sticker_store import MAX_PACK_TITLE


class StickerItem(BaseModel):
    """Один стикер в панели (файл лежит в ``media/``, отдаётся через ``/media``)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    file_url: str
    mime_type: str | None = None
    position: int = 0


class StickerPackOut(BaseModel):
    """Набор стикеров с содержимым — панель показывает его целиком."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    position: int = 0
    #: Публичный (предустановленный) набор: его можно добавить себе целиком.
    is_preset: bool = False
    stickers: list[StickerItem] = Field(default_factory=list)


class StickerLibrary(BaseModel):
    """Библиотека человека: паки по порядку, внутри — стикеры по порядку."""

    packs: list[StickerPackOut] = Field(default_factory=list)


class StickerPackCreate(BaseModel):
    """Новый пак: название можно не присылать — подставим «Мои стикеры»."""

    title: str = Field(default="Мои стикеры", max_length=MAX_PACK_TITLE)


class StickerPackUpdate(BaseModel):
    """Переименование и/или перемещение пака."""

    title: str | None = Field(default=None, max_length=MAX_PACK_TITLE)
    position: int | None = None


class StickerPackPresetUpdate(BaseModel):
    """Отметка «публичный набор» — ставит только суперадмин."""

    is_preset: bool


class StickerUpdate(BaseModel):
    """Перемещение стикера: в другой пак и/или на другую позицию."""

    pack_id: int | None = None
    position: int | None = None


class StickerFromMessage(BaseModel):
    """«В стикеры» из сообщения: копируем картинку в свой пак."""

    message_id: int
    pack_id: int | None = None
