"""API стикеров: свои паки, добавление картинок и «в стикеры» из сообщения.

Стикер — не сообщение, а элемент библиотеки: человек собирает паки один раз, а
отправляет стикер сколько угодно раз (само сообщение при этом обычное вложение с
``kind='sticker'``, см. ``api_v1/messages``).

Про «в стикеры» из сообщения: сервер копирует картинку, только если может её
прочитать. В зашифрованном (E2EE) чате файл лежит шифротекстом, поэтому оттуда
стикер так не сделать — приложение в этом случае загружает уже расшифрованные
байты обычной загрузкой (``POST /stickers/packs/{id}/items/``).
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_user
from api_v1.chats.crud import is_user_chat_member
from core.config import settings
from core.media_crypto import read_file
from core.media_quota import enforce_media_quota
from core.media_store import MEDIA_DIR, store_media
from core.models import Message, StickerPack, User, db_helper
from core.rate_limit import enforce_limit
from core.sticker_store import (
    MAX_PACK_TITLE,
    MAX_STICKER_BYTES,
    MAX_STICKER_PACKS,
    MAX_STICKERS_PER_PACK,
    STICKER_MIME,
    fit_sticker,
    normalize_pack_title,
)
from core.upload_guard import normalize_ext, validate_image_upload

from . import crud
from .schemas import (
    StickerFromMessage,
    StickerItem,
    StickerLibrary,
    StickerPackCreate,
    StickerPackOut,
    StickerPackUpdate,
    StickerUpdate,
)

router = APIRouter(prefix="/stickers", tags=["Стикеры"])

#: Сколько стикеров можно загрузить в минуту (защита от «залей сто паков»).
UPLOAD_LIMIT_PER_MINUTE = settings.message_upload_limit_per_minute


async def _owned_pack(
    session: AsyncSession, *, owner_id: int, pack_id: int, with_stickers: bool = True
) -> StickerPack:
    """Пак человека по id (чужой — 404).

    ``with_stickers=False`` — для ручек, которые отвечают не паком (загрузка
    стикера): там содержимое пака не нужно.
    """
    pack = await crud.get_pack(
        session, owner_id=owner_id, pack_id=pack_id, with_stickers=with_stickers
    )
    if pack is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Набор не найден"
        )
    return pack


async def _default_pack(session: AsyncSession, *, owner_id: int) -> StickerPack:
    """Пак по умолчанию: первый у человека, а если паков нет — создаём.

    Нужен для «в стикеры» из сообщения: человек не обязан заранее заводить пак,
    жест должен работать сразу.
    """
    packs = await crud.get_library(session, owner_id=owner_id)
    if packs:
        return packs[0]
    return await crud.create_pack(
        session,
        owner_id=owner_id,
        payload=StickerPackCreate(),
        title=normalize_pack_title(""),
    )


async def _store_sticker(
    session: AsyncSession,
    *,
    user: User,
    pack: StickerPack,
    content: bytes,
    source_name: str,
) -> StickerItem:
    """Проверяет, приводит к виду и сохраняет стикер в пак.

    Общий путь для загрузки файла и для «в стикеры» из сообщения: правила
    (размер, сторона, формат, лимиты, квота) должны совпадать, иначе один из
    входов стал бы лазейкой.
    """
    if await crud.count_stickers(session, pack_id=pack.id) >= MAX_STICKERS_PER_PACK:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"В наборе уже {MAX_STICKERS_PER_PACK} стикеров — создайте новый",
        )
    fitted = fit_sticker(content)
    if fitted is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Из этой картинки стикер не получится: нужна картинка "
                f"(PNG, WebP или GIF) до {MAX_STICKER_BYTES // 1024} КБ"
            ),
        )
    data, ext = fitted
    # Квота проверяется до записи на диск (см. core/media_quota.py).
    await enforce_media_quota(session, user_id=user.id, incoming_bytes=len(data))
    file_url = store_media(data, f".{ext}")
    sticker = await crud.add_sticker(
        session,
        pack=pack,
        file_url=file_url,
        file_name=f"{Path(source_name).stem[:60]}.{ext}" if source_name else None,
        mime_type=STICKER_MIME[ext],
        file_size=len(data),
    )
    return StickerItem.model_validate(sticker)


@router.get("/", response_model=StickerLibrary)
async def get_library(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> StickerLibrary:
    """Все паки человека со стикерами — этим живёт панель стикеров."""
    packs = await crud.get_library(session, owner_id=user.id)
    return StickerLibrary(packs=[StickerPackOut.model_validate(pack) for pack in packs])


@router.post(
    "/packs/", response_model=StickerPackOut, status_code=status.HTTP_201_CREATED
)
async def create_pack(
    payload: StickerPackCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> StickerPackOut:
    """Создаёт набор (название по умолчанию — «Мои стикеры»)."""
    if await crud.count_packs(session, owner_id=user.id) >= MAX_STICKER_PACKS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Больше {MAX_STICKER_PACKS} наборов не помещается — удалите лишний",
        )
    title = normalize_pack_title(payload.title)[:MAX_PACK_TITLE]
    pack = await crud.create_pack(
        session, owner_id=user.id, payload=payload, title=title
    )
    return StickerPackOut.model_validate(pack)


@router.patch("/packs/{pack_id}", response_model=StickerPackOut)
async def update_pack(
    pack_id: int,
    payload: StickerPackUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> StickerPackOut:
    """Переименовывает набор и/или меняет его место в панели."""
    pack = await _owned_pack(session, owner_id=user.id, pack_id=pack_id)
    title = normalize_pack_title(payload.title) if payload.title is not None else None
    pack = await crud.update_pack(session, pack=pack, payload=payload, title=title)
    return StickerPackOut.model_validate(pack)


@router.delete("/packs/{pack_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pack(
    pack_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> Response:
    """Удаляет набор вместе со стикерами (файлы уберёт ночная уборка)."""
    pack = await _owned_pack(session, owner_id=user.id, pack_id=pack_id)
    await crud.delete_pack(session, pack=pack)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/packs/{pack_id}/items/",
    response_model=StickerItem,
    status_code=status.HTTP_201_CREATED,
)
async def upload_sticker(
    request: Request,
    pack_id: int,
    filename: str = Query(..., min_length=1, max_length=255),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> StickerItem:
    """Добавляет стикер в набор (тело запроса — байты картинки).

    Клиент присылает уже обрезанную картинку, но мы всё равно приводим её к
    виду: так «дырка» в правилах (например, файл на 3 МБ) невозможна.
    """
    pack = await _owned_pack(
        session, owner_id=user.id, pack_id=pack_id, with_stickers=False
    )
    await enforce_limit(
        scope="stickers:upload",
        value=str(user.id),
        limit=UPLOAD_LIMIT_PER_MINUTE,
        window_seconds=60,
        detail="Слишком много загрузок. Попробуйте позже.",
    )
    content = await request.body()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Пустой файл"
        )
    if len(content) > MAX_STICKER_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Стикер слишком большой (максимум {MAX_STICKER_BYTES // 1024} КБ)",
        )
    ext = normalize_ext(filename)
    if ext not in STICKER_MIME:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Стикер — это PNG, WebP или GIF",
        )
    validate_image_upload(f"sticker.{ext}", content)
    return await _store_sticker(
        session, user=user, pack=pack, content=content, source_name=filename
    )


@router.patch("/items/{sticker_id}", response_model=StickerItem)
async def update_sticker(
    sticker_id: int,
    payload: StickerUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> StickerItem:
    """Переносит стикер в другой набор и/или меняет его позицию."""
    sticker = await crud.get_sticker(session, owner_id=user.id, sticker_id=sticker_id)
    if sticker is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Стикер не найден"
        )
    if payload.pack_id is not None:
        await _owned_pack(session, owner_id=user.id, pack_id=payload.pack_id)
    sticker = await crud.update_sticker(session, sticker=sticker, payload=payload)
    return StickerItem.model_validate(sticker)


@router.delete("/items/{sticker_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sticker(
    sticker_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> Response:
    """Убирает стикер из библиотеки."""
    sticker = await crud.get_sticker(session, owner_id=user.id, sticker_id=sticker_id)
    if sticker is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Стикер не найден"
        )
    await crud.delete_sticker(session, sticker=sticker)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/from-message/", response_model=StickerItem, status_code=status.HTTP_201_CREATED
)
async def sticker_from_message(
    payload: StickerFromMessage,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> StickerItem:
    """«В стикеры»: копирует картинку из сообщения в свой набор.

    Работает только там, где сервер может прочитать файл (обычный чат): в E2EE
    вложение — шифротекст, и стикер из него делает приложение, загружая уже
    расшифрованные байты.
    """
    message = await session.get(Message, payload.message_id)
    if message is None or message.hidden_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Сообщение не найдено"
        )
    if not await is_user_chat_member(session, chat_id=message.chat_id, user_id=user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Сообщение не найдено"
        )
    if not message.file_url or not (message.mime_type or "").startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="В этом сообщении нет картинки",
        )
    if message.encrypted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Зашифрованную картинку сервер не прочитает — "
                "сохраните её из приложения"
            ),
        )
    path = MEDIA_DIR / Path(message.file_url).name
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Файл не найден"
        )
    pack = (
        await _owned_pack(
            session, owner_id=user.id, pack_id=payload.pack_id, with_stickers=False
        )
        if payload.pack_id is not None
        else await _default_pack(session, owner_id=user.id)
    )
    return await _store_sticker(
        session,
        user=user,
        pack=pack,
        content=read_file(path),
        source_name=message.file_name or "sticker",
    )
