"""Работа с паками и стикерами в БД.

Все выборки идут с проверкой владельца: чужой пак — это 404, а не «нет прав»,
чтобы по ответу нельзя было перебирать существующие id.
"""

from __future__ import annotations

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.models import Sticker, StickerPack

from .schemas import StickerPackCreate, StickerPackUpdate, StickerUpdate


async def get_library(session: AsyncSession, *, owner_id: int) -> list[StickerPack]:
    """Паки человека со стикерами (порядок паков и стикеров — как в панели)."""
    stmt = (
        select(StickerPack)
        .where(StickerPack.owner_id == owner_id)
        .options(selectinload(StickerPack.stickers))
        .order_by(StickerPack.position, StickerPack.id)
    )
    return list(await session.scalars(stmt))


async def count_packs(session: AsyncSession, *, owner_id: int) -> int:
    """Сколько паков у человека (для лимита)."""
    stmt = select(func.count(StickerPack.id)).where(StickerPack.owner_id == owner_id)
    return int(await session.scalar(stmt) or 0)


async def get_pack(
    session: AsyncSession, *, owner_id: int, pack_id: int, with_stickers: bool = True
) -> StickerPack | None:
    """Пак человека по id (чужой не вернём).

    ``with_stickers=False`` — когда стикеры не нужны (например, загрузка нового):
    так не тянем список из БД зря. По умолчанию грузим: ответ всегда содержит
    содержимое пака, а ленивая загрузка в async-сессии падает с MissingGreenlet.
    """
    stmt = select(StickerPack).where(
        StickerPack.id == pack_id, StickerPack.owner_id == owner_id
    )
    if with_stickers:
        stmt = stmt.options(selectinload(StickerPack.stickers))
    return await session.scalar(stmt)


async def create_pack(
    session: AsyncSession, *, owner_id: int, payload: StickerPackCreate, title: str
) -> StickerPack:
    """Создаёт пак в конец списка."""
    position = await count_packs(session, owner_id=owner_id)
    pack = StickerPack(owner_id=owner_id, title=title, position=position)
    session.add(pack)
    await session.commit()
    await session.refresh(pack)
    # Пустой список — тоже часть ответа: без явной загрузки он вызовет ленивое
    # обращение к БД при сериализации.
    await session.refresh(pack, ["stickers"])
    return pack


async def update_pack(
    session: AsyncSession,
    *,
    pack: StickerPack,
    payload: StickerPackUpdate,
    title: str | None,
) -> StickerPack:
    """Переименовывает и/или перемещает пак."""
    if title is not None:
        pack.title = title
    if payload.position is not None:
        pack.position = max(0, payload.position)
    await session.commit()
    # Колонки после commit просрочены, а стикеры не загружены — оба обращения
    # к БД делаем здесь, а не на сериализации ответа.
    await session.refresh(pack, ["title", "position", "stickers"])
    return pack


async def delete_pack(session: AsyncSession, *, pack: StickerPack) -> None:
    """Удаляет пак вместе со стикерами (файлы уберёт ночная уборка сирот)."""
    await session.execute(delete(StickerPack).where(StickerPack.id == pack.id))
    await session.commit()


async def count_stickers(session: AsyncSession, *, pack_id: int) -> int:
    """Сколько стикеров в паке (для лимита)."""
    stmt = select(func.count(Sticker.id)).where(Sticker.pack_id == pack_id)
    return int(await session.scalar(stmt) or 0)


async def add_sticker(
    session: AsyncSession,
    *,
    pack: StickerPack,
    file_url: str,
    file_name: str | None,
    mime_type: str | None,
    file_size: int | None,
) -> Sticker:
    """Добавляет стикер в конец пака."""
    position = await count_stickers(session, pack_id=pack.id)
    sticker = Sticker(
        pack_id=pack.id,
        file_url=file_url,
        file_name=file_name,
        mime_type=mime_type,
        file_size=file_size,
        position=position,
    )
    session.add(sticker)
    await session.commit()
    await session.refresh(sticker)
    return sticker


async def get_sticker(
    session: AsyncSession, *, owner_id: int, sticker_id: int
) -> Sticker | None:
    """Стикер человека по id (через его пак)."""
    stmt = (
        select(Sticker)
        .join(StickerPack, StickerPack.id == Sticker.pack_id)
        .where(Sticker.id == sticker_id, StickerPack.owner_id == owner_id)
    )
    return await session.scalar(stmt)


async def update_sticker(
    session: AsyncSession, *, sticker: Sticker, payload: StickerUpdate
) -> Sticker:
    """Переносит стикер в другой пак и/или меняет позицию."""
    if payload.pack_id is not None and payload.pack_id != sticker.pack_id:
        sticker.pack_id = payload.pack_id
        # В новом паке ставим в конец: иначе два стикера делят одну позицию.
        sticker.position = await count_stickers(session, pack_id=payload.pack_id)
    if payload.position is not None:
        sticker.position = max(0, payload.position)
    await session.commit()
    await session.refresh(sticker)
    return sticker


async def delete_sticker(session: AsyncSession, *, sticker: Sticker) -> None:
    """Удаляет стикер.

    Файл на диске не трогаем: тот же ``file_url`` мог остаться у отправленного
    сообщения («сохранить в стикеры» переиспользует файл сообщения). Сироты
    убирает ночная задача ``scripts/cleanup_orphan_media.py``.
    """
    await session.execute(delete(Sticker).where(Sticker.id == sticker.id))
    await session.commit()
