"""Эндпоинты модерации: жалобы на контент и блокировка пользователей.

Нужны для требований RuStore к приложениям с пользовательским контентом:
у пользователя должен быть способ сообщить о неприемлемом контенте и
заблокировать нарушителя.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth import audit, security_notifications
from api_v1.auth.refresh_sessions import revoke_all_sessions
from api_v1.auth.utils import get_current_admin, get_current_user
from api_v1.chats.crud import is_user_chat_member
from core.config import settings
from core.models import Message, User, UserReport, db_helper
from core.models.moderation_action import (
    ACTION_ACCOUNT_FROZEN,
    ACTION_ACCOUNT_UNFROZEN,
    ACTION_MESSAGE_RESTORED,
    ACTION_REPORT_CREATED,
    ACTION_SESSIONS_REVOKED,
)
from core.rate_limit import enforce_limit

from . import crud, schemas, service

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
    await service.log_action(
        session,
        action=ACTION_REPORT_CREATED,
        target_user_id=payload.user_id,
        report_id=report.id,
        message_id=payload.message_id,
        note=f"жалоба от пользователя {user.id}: "
        f"{service.REASON_TITLES.get(payload.reason, payload.reason)}",
    )
    # Автоматика: достаточно жалоб от разных людей — скрываем до разбора и
    # рассказываем автору письмом (см. moderation/service.py).
    await service.maybe_auto_hide(
        session, message_id=payload.message_id, reported_id=payload.user_id
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
    admin: Annotated[User, Depends(get_current_admin)],
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
    admin: Annotated[User, Depends(get_current_admin)],
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
    # Решение влияет на контент: подтверждение скрывает сообщение, отклонение
    # возвращает ранее скрытое. Заявителю уходит письмо, действие — в журнал.
    changed = await service.apply_report_status(
        session,
        updated,
        moderator_id=admin.id,
        status=payload.status,
        note=payload.note,
    )
    logger.info(
        "Жалоба #%s разобрана: статус %s (модератор %s), скрыто=%s, восстановлено=%s",
        updated.id,
        updated.status,
        admin.id,
        changed["hidden"],
        changed["restored"],
    )
    items = await _serialize_reports(session, [updated])
    return items[0]


@router.get("/journal/", response_model=schemas.JournalResponse)
async def get_journal(
    admin: Annotated[User, Depends(get_current_admin)],
    session: AsyncSession = Depends(db_helper.session_dependency),
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> schemas.JournalResponse:
    """Журнал модерации: кто, когда и что сделал (включая действия автомата).

    Нужен для разбора споров («почему сообщение скрыто») и как доказательство
    разбора UGC — требование магазинов приложений.
    """
    rows, total = await service.list_journal(session, limit=limit, offset=offset)
    hidden = await service.hidden_messages_count(session)
    return schemas.JournalResponse(
        total=total,
        hidden_messages=hidden,
        items=[
            schemas.JournalItemSchema(
                id=row.id,
                action=row.action,
                moderator_id=row.moderator_id,
                target_user_id=row.target_user_id,
                report_id=row.report_id,
                message_id=row.message_id,
                note=row.note,
                created_at=row.created_at,
            )
            for row in rows
        ],
    )


@router.post("/users/{user_id}/unhide/", response_model=schemas.UnhideResponse)
async def unhide_user_messages(
    user_id: int,
    admin: Annotated[User, Depends(get_current_admin)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> schemas.UnhideResponse:
    """Снимает скрытие со всех сообщений автора (жалобы оказались ложными)."""
    restored = await service.unhide_all_for_user(session, user_id=user_id)
    await service.log_action(
        session,
        action=ACTION_MESSAGE_RESTORED,
        moderator_id=admin.id,
        target_user_id=user_id,
        note=f"снято скрытие с {restored} сообщений (модератор {admin.id})",
    )
    return schemas.UnhideResponse(restored=restored)


@router.get("/blocks/", response_model=list[schemas.BlockedUserItem])
async def list_blocked(
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[schemas.BlockedUserItem]:
    """Возвращает список заблокированных мной пользователей.

    В каждой строке — вид блокировки (полная или «только звонки»), чтобы экран
    «Заблокированные» мог показать состояние и дать его переключить.
    """
    rows = await crud.get_blocked_users(session, blocker_id=user.id)
    return [
        schemas.BlockedUserItem(
            id=blocked.id,
            username=blocked.username,
            first_name=blocked.first_name,
            last_name=blocked.last_name,
            avatar_url=blocked.avatar_url,
            avatar_thumb_url=blocked.avatar_thumb_url,
            messages_allowed=messages_allowed,
        )
        for blocked, messages_allowed in rows
    ]


@router.put("/blocks/{user_id}/", response_model=schemas.BlockStateResponse)
async def block_user(
    user_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
    payload: Annotated[schemas.BlockRequest | None, Body()] = None,
) -> schemas.BlockStateResponse:
    """Блокирует пользователя (или меняет вид уже стоящей блокировки).

    Без тела запроса — полная блокировка (как было). С
    ``messages_allowed=true`` — «только звонки»: он не сможет дозвониться, но
    переписка и чат остаются на месте.
    """
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
    messages_allowed = bool(payload.messages_allowed) if payload else False
    await crud.block_user(
        session,
        blocker_id=user.id,
        blocked_id=user_id,
        messages_allowed=messages_allowed,
    )
    return schemas.BlockStateResponse(blocked=True, messages_allowed=messages_allowed)


@router.get("/blocks/{user_id}/", response_model=schemas.BlockStateResponse)
async def get_block_state(
    user_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> schemas.BlockStateResponse:
    """Стоит ли блокировка на этого пользователя и какого она вида.

    Нужно интерфейсу, чтобы показать верные подписи в меню чата. Рассказываем
    только про СВОЮ блокировку: чужие не раскрываем.
    """
    messages_allowed = await crud.get_block_messages_allowed(
        session, blocker_id=user.id, blocked_id=user_id
    )
    return schemas.BlockStateResponse(
        blocked=messages_allowed is not None,
        messages_allowed=bool(messages_allowed),
    )


@router.delete("/blocks/{user_id}/", response_model=schemas.BlockStateResponse)
async def unblock_user(
    user_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> schemas.BlockStateResponse:
    """Снимает блокировку с пользователя (идемпотентно, любого вида)."""
    await crud.unblock_user(session, blocker_id=user.id, blocked_id=user_id)
    return schemas.BlockStateResponse(blocked=False)


# --- Поддержка: спасение угнанного аккаунта --------------------------------
# По обращению владельца («в аккаунт вошли чужие») поддержка закрывает доступ
# вору, не имея доступа к паролю и токенам: сессии отзываются, аккаунт можно
# заморозить. Каждое действие попадает в журнал модерации и в журнал самого
# пользователя — «кто-то тихо трогал мой аккаунт» должно быть видно.


@router.post(
    "/users/{user_id}/revoke-sessions/", response_model=schemas.BlockStateResponse
)
async def admin_revoke_sessions(
    user_id: int,
    admin: Annotated[User, Depends(get_current_admin)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> schemas.BlockStateResponse:
    """Завершает все входы пользователя (включая украденные токены)."""
    target = await session.get(User, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    await revoke_all_sessions(session, user_id=user_id)
    await audit.log_security_event(
        session,
        event="admin_sessions_revoked",
        user_id=user_id,
        detail=f"все входы завершены поддержкой (модератор {admin.id})",
    )
    await service.log_action(
        session,
        action=ACTION_SESSIONS_REVOKED,
        moderator_id=admin.id,
        target_user_id=user_id,
        note="поддержка завершила все входы пользователя",
    )
    logger.warning("Модератор %s отозвал все сессии пользователя %s", admin.id, user_id)
    return schemas.BlockStateResponse(blocked=False)


@router.post("/users/{user_id}/freeze/", response_model=schemas.BlockStateResponse)
async def admin_freeze_user(
    user_id: int,
    admin: Annotated[User, Depends(get_current_admin)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> schemas.BlockStateResponse:
    """Заморозка аккаунта поддержкой (по обращению владельца)."""
    target = await session.get(User, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    if target.is_active:
        target.is_active = False
        await session.commit()
    await revoke_all_sessions(session, user_id=user_id)
    await audit.log_security_event(
        session,
        event="admin_frozen",
        user_id=user_id,
        detail=f"аккаунт заморожен поддержкой (модератор {admin.id})",
    )
    await service.log_action(
        session,
        action=ACTION_ACCOUNT_FROZEN,
        moderator_id=admin.id,
        target_user_id=user_id,
        note="поддержка заморозила аккаунт",
    )
    await security_notifications.notify_account_frozen(
        session, user=target, source="support"
    )
    logger.warning("Модератор %s заморозил аккаунт %s", admin.id, user_id)
    return schemas.BlockStateResponse(blocked=True)


@router.post("/users/{user_id}/unfreeze/", response_model=schemas.BlockStateResponse)
async def admin_unfreeze_user(
    user_id: int,
    admin: Annotated[User, Depends(get_current_admin)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> schemas.BlockStateResponse:
    """Снимает заморозку (владелец подтвердил, что доступ вернул себе)."""
    target = await session.get(User, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    if not target.is_active:
        target.is_active = True
        await session.commit()
    await audit.log_security_event(
        session,
        event="admin_unfrozen",
        user_id=user_id,
        detail=f"аккаунт разморожен поддержкой (модератор {admin.id})",
    )
    await service.log_action(
        session,
        action=ACTION_ACCOUNT_UNFROZEN,
        moderator_id=admin.id,
        target_user_id=user_id,
        note="поддержка сняла заморозку аккаунта",
    )
    await security_notifications.notify_account_unfrozen(session, user=target)
    return schemas.BlockStateResponse(blocked=False)
