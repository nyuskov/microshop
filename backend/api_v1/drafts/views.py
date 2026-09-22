"""Черновики сообщений: незаконченный текст живёт на сервере.

Зачем: черновик в localStorage не переживает переустановку приложения и не
доступен с другого устройства. Здесь он привязан к паре (пользователь, чат) —
как «замьюченные» чаты.

Содержимое не разбирается: в чате со сквозным шифрованием клиент присылает
шифротекст (``e2ee1:…``), сервер его только хранит. Пустой текст означает
удаление черновика: стёр поле — стороки в базе нет.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.i18n import t
from core.models import User, db_helper
from core.rate_limit import enforce_limit

from ..auth.utils import get_current_user
from ..chats.crud import is_user_chat_member
from . import crud

router = APIRouter(prefix="/drafts", tags=["Черновики"])

#: Предел длины черновика. Больше, чем сообщение: в поле может лежать вставленный
#: текст, который пользователь ещё сократит.
MAX_DRAFT_LENGTH = 4000


class DraftSchema(BaseModel):
    """Черновик глазами владельца: тот же текст, что уходит в сообщение."""

    chat_id: int
    text: str
    updated_at: datetime


class DraftUpsertRequest(BaseModel):
    """Сохранение черновика. Пустая строка — удалить черновик."""

    text: str = Field(default="", max_length=MAX_DRAFT_LENGTH)


async def _ensure_member(session: AsyncSession, user: User, chat_id: int) -> None:
    """Черновик можно держать только в своём чате.

    Отвечаем 404 (как везде с чужими чатами): существование чата не подтверждаем.
    """
    if not await is_user_chat_member(session, chat_id=chat_id, user_id=user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=t("Чат не найден"),
        )


def _serialize(row) -> DraftSchema:
    return DraftSchema(chat_id=row.chat_id, text=row.text, updated_at=row.updated_at)


@router.get("/", response_model=list[DraftSchema])
async def list_my_drafts(
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[DraftSchema]:
    """Все мои черновики (свежие сверху) — для превью в списке чатов."""
    rows = await crud.list_drafts(session, user_id=user.id)
    return [_serialize(row) for row in rows]


@router.put("/{chat_id}/", response_model=DraftSchema | None)
async def upsert_my_draft(
    chat_id: int,
    payload: DraftUpsertRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> DraftSchema | None:
    """Сохраняет черновик чата. Пустой текст — черновик удаляется."""
    await _ensure_member(session, user, chat_id)
    await enforce_limit(
        scope="drafts:write",
        value=str(user.id),
        limit=settings.draft_write_limit_per_minute,
        window_seconds=60,
        detail=t("Слишком много запросов. Попробуйте позже."),
    )
    if not payload.text.strip():
        await crud.delete_draft(session, user_id=user.id, chat_id=chat_id)
        return None
    row = await crud.upsert_draft(
        session, user_id=user.id, chat_id=chat_id, text=payload.text
    )
    return _serialize(row)


@router.delete("/{chat_id}/", status_code=204)
async def delete_my_draft(
    chat_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Убирает черновик чата (сообщение отправлено или текст стёрли)."""
    await crud.delete_draft(session, user_id=user.id, chat_id=chat_id)
