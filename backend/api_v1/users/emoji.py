"""Настройки паков эмодзи и «Моих» эмодзи — на аккаунт, а не на устройство.

Почему на сервере: выбор должен переезжать между устройствами (отметил паки на
телефоне — видно и на ноутбуке). Каталог самих паков живёт в клиенте
(``frontend/src/utils/emojiPacks.ts``): это наборы Unicode-эмодзи, они меняются
вместе с релизом приложения, и хранить их копию в базе незачем — сервер держит
только ключи паков и избранные эмодзи.

``PUT`` — «заменить целиком»: панель присылает итоговый список, и он же задаёт
порядок вкладок. Так не нужны отдельные ручки на добавление, удаление и
перестановку, а состояние на сервере всегда ровно то, что человек видит.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_user
from core.models import EmojiFavorite, EmojiPackChoice, User, db_helper

router = APIRouter(prefix="/users/me/emoji", tags=["Эмодзи"])

#: Сколько паков можно включить себе (каталог клиента заметно меньше).
MAX_PACK_CHOICES = 40
#: Сколько эмодзи держать в «Моих».
MAX_FAVORITES = 120
#: Длина ключа пака — как колонка `emoji_pack_choices.pack_key`.
MAX_PACK_KEY = 40
#: Максимальная длина эмодзи-последовательности (флаг/семья — до ~11 кодовых точек).
MAX_EMOJI_LEN = 64


class EmojiPrefs(BaseModel):
    """Выбор человека: ключи паков по порядку и эмодзи в «Моих» по порядку."""

    packs: list[str] = Field(default_factory=list)
    favorites: list[str] = Field(default_factory=list)


def clean_pack_keys(keys: list[str]) -> list[str]:
    """Ключи паков: без пустых, дублей и слишком длинных; порядок сохраняем.

    Порядок здесь — это порядок вкладок в панели, поэтому «отсортировать» его
    нельзя: человек расставил паки сам.
    """
    result: list[str] = []
    for raw in keys:
        key = raw.strip()
        if not key or len(key) > MAX_PACK_KEY:
            continue
        if key in result:
            continue
        result.append(key)
        if len(result) >= MAX_PACK_CHOICES:
            break
    return result


def clean_favorites(items: list[str]) -> list[str]:
    """Избранные эмодзи: без дублей и мусора, с ограничением длины списка.

    Внутренние пробелы не трогаем: «🙂 🙂» — это два эмодзи в одной строке, и
    такое в «Моих» вполне допустимо.
    """
    result: list[str] = []
    for raw in items:
        emoji = raw.strip()
        if not emoji or len(emoji) > MAX_EMOJI_LEN:
            continue
        if emoji in result:
            continue
        result.append(emoji)
        if len(result) >= MAX_FAVORITES:
            break
    return result


@router.get("/", response_model=EmojiPrefs)
async def get_emoji_prefs(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> EmojiPrefs:
    """Что у человека включено и что лежит в «Моих»."""
    pack_rows = await session.execute(
        select(EmojiPackChoice.pack_key)
        .where(EmojiPackChoice.user_id == user.id)
        .order_by(EmojiPackChoice.position)
    )
    favorite_rows = await session.execute(
        select(EmojiFavorite.emoji)
        .where(EmojiFavorite.user_id == user.id)
        .order_by(EmojiFavorite.position)
    )
    return EmojiPrefs(
        packs=list(pack_rows.scalars()),
        favorites=list(favorite_rows.scalars()),
    )


@router.put("/", response_model=EmojiPrefs)
async def save_emoji_prefs(
    payload: EmojiPrefs,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> EmojiPrefs:
    """Заменяет выбор целиком (порядок списка = порядок в панели)."""
    packs = clean_pack_keys(payload.packs)
    favorites = clean_favorites(payload.favorites)

    await session.execute(
        delete(EmojiPackChoice).where(EmojiPackChoice.user_id == user.id)
    )
    await session.execute(delete(EmojiFavorite).where(EmojiFavorite.user_id == user.id))
    for position, key in enumerate(packs):
        session.add(EmojiPackChoice(user_id=user.id, pack_key=key, position=position))
    for position, emoji in enumerate(favorites):
        session.add(EmojiFavorite(user_id=user.id, emoji=emoji, position=position))
    await session.commit()

    return EmojiPrefs(packs=packs, favorites=favorites)
