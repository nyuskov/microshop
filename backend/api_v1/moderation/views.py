"""Эндпоинты модерации: жалобы на контент и блокировка пользователей.

Нужны для требований RuStore к приложениям с пользовательским контентом:
у пользователя должен быть способ сообщить о неприемлемом контенте и
заблокировать нарушителя.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_superuser, get_current_user
from api_v1.chats.crud import is_user_chat_member
from api_v1.rate_limit import enforce_limit
from api_v1.users.schemas import UserSearchResultSchema
from core.config import settings
from core.models import Message, User, UserReport, db_helper

from . import crud, schemas

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/moderation", tags=["Moderation"])


@router.post(
    "/reports/",
    response_model=schemas.ReportResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_report(
    payload: schemas.ReportCreateRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> schemas.ReportResponse:
    """Отправляет жалобу на пользователя (и, возможно, на сообщение)."""
    if payload.user_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя отправить жалобу на себя",
        )

    target = await session.get(User, payload.user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )

    await enforce_limit(
        scope="moderation:report",
        value=str(user.id),
        limit=settings.user_report_limit_per_hour,
        window_seconds=3600,
        detail="Слишком много жалоб. Попробуйте позже.",
    )

    chat_id: int | None = None
    if payload.message_id is not None:
        message = await session.get(Message, payload.message_id)
        if message is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Сообщение не найдено",
            )
        if not await is_user_chat_member(
            session, chat_id=message.chat_id, user_id=user.id
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Нет доступа к этому сообщению",
            )
        chat_id = message.chat_id
    elif payload.chat_id is not None:
        # Жалоба «на пользователя» из открытого диалога: сохраняем контекст чата,
        # чтобы модератор видел, где именно произошло нарушение.
        if not await is_user_chat_member(
            session, chat_id=payload.chat_id, user_id=user.id
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Нет доступа к этому чату",
            )
        chat_id = payload.chat_id

    comment = (payload.comment or "").strip() or None
    report = await crud.create_report(
        session,
        reporter_id=user.id,
        reported_id=payload.user_id,
        reason=payload.reason,
        comment=comment,
        chat_id=chat_id,
        message_id=payload.message_id,
    )
    # Жалобы разбирают модераторы: их видно в таблице user_reports (status='new').
    logger.info(
        "Жалоба #%s: пользователь %s → %s, причина %s",
        report.id,
        user.id,
        payload.user_id,
        payload.reason,
    )
    return schemas.ReportResponse(id=report.id, status=report.status)


def _display_name(user: User) -> str:
    """Отображаемое имя пользователя (как displayName на фронте)."""
    if user.first_name and user.last_name:
        return f"{user.first_name} {user.last_name}"
    if user.first_name:
        return user.first_name
    if user.last_name:
        return user.last_name
    return user.username


async def _serialize_reports(
    session: AsyncSession, reports: list[UserReport]
) -> list[schemas.ReportItem]:
    """Жалобы в схему, с именами/телефонами участников (один запрос на всех)."""
    user_ids = {r.reporter_id for r in reports} | {r.reported_id for r in reports}
    users = await crud.get_users_by_ids(session, user_ids=user_ids)
    message_ids = {r.message_id for r in reports if r.message_id is not None}
    texts = await crud.get_messages_text(session, message_ids=message_ids)

    def name_of(user_id: int) -> str | None:
        found = users.get(user_id)
        return _display_name(found) if found is not None else None

    def phone_of(user_id: int) -> str | None:
        found = users.get(user_id)
        return found.phone_number if found is not None else None

    def text_of(message_id: int | None) -> str | None:
        if message_id is None:
            return None
        text = texts.get(message_id)
        return text[:300] if text else text

    return [
        schemas.ReportItem(
            id=report.id,
            reporter_id=report.reporter_id,
            reporter_name=name_of(report.reporter_id),
            reporter_phone=phone_of(report.reporter_id),
            reported_id=report.reported_id,
            reported_name=name_of(report.reported_id),
            reported_phone=phone_of(report.reported_id),
            reason=report.reason,
            comment=report.comment,
            chat_id=report.chat_id,
            message_id=report.message_id,
            message_text=text_of(report.message_id),
            status=report.status,
            note=report.note,
            created_at=report.created_at,
            reviewed_at=report.reviewed_at,
        )
        for report in reports
    ]


@router.get("/reports/", response_model=schemas.ReportListResponse)
async def list_reports(
    admin: Annotated[User, Depends(get_current_superuser)],
    session: AsyncSession = Depends(db_helper.session_dependency),
    report_status: Annotated[schemas.ReportStatus | None, Query(alias="status")] = None,
    reason: Annotated[schemas.ReportReason | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> schemas.ReportListResponse:
    """Список жалоб для разбора (только администраторы).

    По умолчанию отдаёт все жалобы (свежие первыми); типичный разбор —
    ``?status=new``. Поддерживает фильтр по причине и пагинацию.
    """
    reports, total = await crud.list_reports(
        session, status=report_status, reason=reason, limit=limit, offset=offset
    )
    return schemas.ReportListResponse(
        total=total, items=await _serialize_reports(session, reports)
    )


@router.patch("/reports/{report_id}/", response_model=schemas.ReportItem)
async def update_report(
    report_id: int,
    payload: schemas.ReportUpdateRequest,
    admin: Annotated[User, Depends(get_current_superuser)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> schemas.ReportItem:
    """Меняет статус разбора жалобы (и, при желании, оставляет заметку)."""
    report = await crud.get_report(session, report_id=report_id)
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Жалоба не найдена"
        )
    updated = await crud.update_report_status(
        session, report, status=payload.status, note=payload.note
    )
    logger.info(
        "Жалоба #%s разобрана: статус %s (модератор %s)",
        updated.id,
        updated.status,
        admin.id,
    )
    items = await _serialize_reports(session, [updated])
    return items[0]


@router.get("/blocks/", response_model=list[UserSearchResultSchema])
async def list_blocked(
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[User]:
    """Возвращает список заблокированных мной пользователей."""
    return await crud.get_blocked_users(session, blocker_id=user.id)


@router.put("/blocks/{user_id}/", response_model=schemas.BlockStateResponse)
async def block_user(
    user_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> schemas.BlockStateResponse:
    """Блокирует пользователя: он не сможет писать, чат скрывается из списка."""
    if user_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя заблокировать себя",
        )
    target = await session.get(User, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    await crud.block_user(session, blocker_id=user.id, blocked_id=user_id)
    return schemas.BlockStateResponse(blocked=True)


@router.delete("/blocks/{user_id}/", response_model=schemas.BlockStateResponse)
async def unblock_user(
    user_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> schemas.BlockStateResponse:
    """Снимает блокировку с пользователя (идемпотентно)."""
    await crud.unblock_user(session, blocker_id=user.id, blocked_id=user_id)
    return schemas.BlockStateResponse(blocked=False)
