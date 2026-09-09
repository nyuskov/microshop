"""Эндпоинты ключей сквозного шифрования (E2EE).

Клиент (браузер) генерирует пару ключей ECDH P-256, приватную часть хранит
только у себя, публичную регистрирует здесь (``PUT /keys/me/``). Перед
шифрованием/расшифровкой сообщений клиент забирает публичный ключ
собеседника (``GET /keys/{user_id}/``). Сервер хранит только публичные ключи
и шифротекст и не может прочитать содержимое зашифрованных сообщений.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import DeviceKey, User, db_helper

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
