"""Эндпоинты ключей сквозного шифрования (E2EE).

Клиент (браузер) генерирует пару ключей ECDH P-256, приватную часть хранит
только у себя, публичную регистрирует здесь (``PUT /keys/me/``). Перед
шифрованием/расшифровкой сообщений клиент забирает публичный ключ
собеседника (``GET /keys/{user_id}/``). Сервер хранит только публичные ключи
и шифротекст и не может прочитать содержимое зашифрованных сообщений.

Для групповых чатов используется отдельный уровень: ключ группы (случайные
32 байта) раздаётся участникам «обёртками» (``PUT/GET /keys/group/{chat_id}/``)
— каждая обёртка зашифрована на общем секрете ECDH между раздавшим и
получателем, поэтому сервер ключ группы вычислить не может.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import (
    Chat,
    ChatGroupKey,
    DeviceKey,
    User,
    db_helper,
    user_chat_association_table,
)

from ..auth.utils import get_current_user

router = APIRouter(prefix="/keys", tags=["E2EE-ключи"])


class PutMyKeyRequest(BaseModel):
    """Публичная часть ключа устройства (JWK), загружаемая на сервер."""

    public_key: str = Field(..., min_length=1, max_length=4096)


class KeyResponse(BaseModel):
    user_id: int
    has_key: bool
    public_key: str | None = None


@router.put("/me/", status_code=200)
async def put_my_key(
    payload: PutMyKeyRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, bool]:
    """Регистрирует/заменяет «текущий» публичный ключ моего устройства."""
    row = (
        await session.execute(select(DeviceKey).where(DeviceKey.user_id == user.id))
    ).scalar_one_or_none()
    if row is None:
        row = DeviceKey(user_id=user.id, public_key=payload.public_key)
        session.add(row)
    else:
        row.public_key = payload.public_key
    await session.commit()
    return {"ok": True}


@router.get("/{user_id}/", response_model=KeyResponse)
async def get_user_key(
    user_id: int,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> KeyResponse:
    """Возвращает публичный ключ пользователя (или пустой, если ключа нет).

    Публичные ключи E2EE не являются секретом, поэтому доступны любому
    авторизованному пользователю.
    """
    row = (
        await session.execute(select(DeviceKey).where(DeviceKey.user_id == user_id))
    ).scalar_one_or_none()
    if row is None:
        return KeyResponse(user_id=user_id, has_key=False, public_key=None)
    return KeyResponse(user_id=user_id, has_key=True, public_key=row.public_key)


# --------------------------------------------------------------------------
# Ключ группы (E2EE в групповых чатах)
# --------------------------------------------------------------------------


class GroupKeyEntry(BaseModel):
    """Обёртка ключа группы для одного участника."""

    user_id: int
    wrapped_key: str = Field(..., min_length=1, max_length=8192)


class PutGroupKeysRequest(BaseModel):
    """Набор обёрток: ``replace=true`` — сначала стереть прежние (ротация)."""

    keys: list[GroupKeyEntry] = Field(..., min_length=1, max_length=256)
    replace: bool = False


class GroupKeyResponse(BaseModel):
    chat_id: int
    has_key: bool
    wrapped_key: str | None = None
    wrapped_by: int | None = None


async def _ensure_member(session: AsyncSession, *, chat_id: int, user_id: int) -> None:
    """404, если пользователь не состоит в чате (не раскрываем чужие чаты)."""
    member_id = await session.scalar(
        select(user_chat_association_table.c.user_id).where(
            user_chat_association_table.c.chat_id == chat_id,
            user_chat_association_table.c.user_id == user_id,
        )
    )
    if member_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Чат не найден",
        )


async def _ensure_group_e2ee_chat(session: AsyncSession, chat_id: int) -> None:
    """400, если это не групповой чат или в нём не включено шифрование."""
    chat = await session.get(Chat, chat_id)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Чат не найден",
        )
    if not chat.is_group or not chat.e2ee_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ключ группы доступен только для зашифрованных групп",
        )


@router.get("/group/{chat_id}/", response_model=GroupKeyResponse)
async def get_my_group_key(
    chat_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> GroupKeyResponse:
    """Отдаёт МОЮ обёртку ключа группы (расшифровать её может только клиент)."""
    await _ensure_member(session, chat_id=chat_id, user_id=user.id)
    row = await session.get(ChatGroupKey, {"chat_id": chat_id, "user_id": user.id})
    if row is None:
        return GroupKeyResponse(chat_id=chat_id, has_key=False)
    return GroupKeyResponse(
        chat_id=chat_id,
        has_key=True,
        wrapped_key=row.wrapped_key,
        wrapped_by=row.wrapped_by,
    )


@router.put("/group/{chat_id}/", status_code=200)
async def put_group_keys(
    chat_id: int,
    payload: PutGroupKeysRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, int]:
    """Загружает обёртки ключа группы для участников (раздал их текущий юзер).

    Любой участник зашифрованной группы может раздать ключ (например, когда
    состав изменился, а создателя нет в сети) — проверяется только членство
    получателей и то, что чат действительно зашифрованная группа.
    """
    await _ensure_member(session, chat_id=chat_id, user_id=user.id)
    await _ensure_group_e2ee_chat(session, chat_id)

    target_ids = {entry.user_id for entry in payload.keys}
    member_ids = set(
        (
            await session.execute(
                select(user_chat_association_table.c.user_id).where(
                    user_chat_association_table.c.chat_id == chat_id
                )
            )
        )
        .scalars()
        .all()
    )
    if not target_ids <= member_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Можно раздать ключ только участникам чата",
        )

    if payload.replace:
        await session.execute(
            delete(ChatGroupKey).where(ChatGroupKey.chat_id == chat_id)
        )

    for entry in payload.keys:
        stmt = pg_insert(ChatGroupKey).values(
            chat_id=chat_id,
            user_id=entry.user_id,
            wrapped_key=entry.wrapped_key,
            wrapped_by=user.id,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[ChatGroupKey.chat_id, ChatGroupKey.user_id],
            set_={
                "wrapped_key": entry.wrapped_key,
                "wrapped_by": user.id,
            },
        )
        await session.execute(stmt)

    await session.commit()
    return {"count": len(payload.keys)}
