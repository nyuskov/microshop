"""Эндпоинты контактов: личная «записная книжка» пользователя.

Контакт — это личный список владельца: кого он добавил и как называет.
Псевдоним (``custom_name``) видит только владелец — в списке чатов, шапке,
карточке и push-уведомлениях. Собеседник о нём не узнаёт.

Отдельно есть «справочник» (``GET /users/contacts/``) — он отдаёт всех
пользователей и нужен, чтобы найти человека для нового чата или группы.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.rate_limit import enforce_limit
from core.config import settings
from core.models import Contact, User, db_helper

from ..auth.utils import get_current_user
from ..users.schemas import UserSearchResultSchema
from . import crud

router = APIRouter(prefix="/contacts", tags=["Контакты"])


class ContactSchema(BaseModel):
    """Контакт глазами владельца: данные человека + мой псевдоним."""

    user: UserSearchResultSchema
    custom_name: str | None = None
    created_at: datetime


class ContactUpsertRequest(BaseModel):
    """Добавление/переименование: пустое имя — показывать обычное."""

    custom_name: str | None = Field(default=None, max_length=120)


def _serialize(row: Contact, contact_user: User) -> ContactSchema:
    """Контакт в формат API (псевдоним отдаём как есть, без пробелов)."""
    return ContactSchema(
        user=UserSearchResultSchema.model_validate(contact_user),
        custom_name=(row.custom_name or "").strip() or None,
        created_at=row.created_at,
    )


async def _enforce_write_limit(user: User) -> None:
    """Лимит на добавления/переименования (защита от спама запросами)."""
    await enforce_limit(
        scope="contacts:write",
        value=str(user.id),
        limit=settings.contact_write_limit_per_minute,
        window_seconds=60,
        detail="Слишком много запросов. Попробуйте позже.",
    )


@router.get("/", response_model=list[ContactSchema])
async def list_my_contacts(
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[ContactSchema]:
    """Мои контакты (сначала те, кого я назвал сам)."""
    rows = await crud.list_contacts(session, owner_id=user.id)
    items = [_serialize(row, contact_user) for row, contact_user in rows]
    items.sort(
        key=lambda item: (
            item.custom_name or item.user.first_name or item.user.username
        ).lower()
    )
    return items


@router.put("/{user_id}/", response_model=ContactSchema)
async def upsert_my_contact(
    user_id: int,
    payload: ContactUpsertRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> ContactSchema:
    """Добавляет человека в контакты или меняет его псевдоним.

    Повторный вызов с другим ``custom_name`` — переименование; с пустым — сброс
    псевдонима (показывается обычное имя).
    """
    if user_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Себя в контакты добавить нельзя",
        )
    target = await session.get(User, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    await _enforce_write_limit(user)
    row = await crud.upsert_contact(
        session,
        owner_id=user.id,
        contact_user_id=user_id,
        custom_name=(payload.custom_name or "").strip() or None,
    )
    return _serialize(row, target)


@router.delete("/{user_id}/", status_code=204)
async def delete_my_contact(
    user_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Убирает человека из контактов. Переписка при этом остаётся."""
    await _enforce_write_limit(user)
    await crud.delete_contact(session, owner_id=user.id, contact_user_id=user_id)
