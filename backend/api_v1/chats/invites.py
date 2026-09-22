"""Ссылки-приглашения в группы: создание, отзыв и вход по ссылке.

Механика: создатель или админ группы делает ссылку вида `/j/<токен>`, отправляет
её человеку, тот открывает — и присоединяется к группе. Ссылку можно ограничить
по сроку и числу входов и отозвать в любой момент.

Безопасность и правила:

* ссылки бывают только у групп (в личный чат «по ссылке» войти нельзя — там
  участников ровно двое);
* создавать и отзывать ссылки могут только создатель и админы;
* токен — случайная строка, а не id: перебор «соседних» ссылок невозможен;
* в зашифрованную группу по ссылке войти нельзя: без обёртки ключа группы
  (``chat_group_keys``) новый участник не прочитает ни переписку, ни новые
  сообщения, а обёртку делает клиент существующего участника. Такой вход мы
  отклоняем с понятным объяснением, а не даём «пустую» группу;
* вход идемпотентен: уже состоящий в группе получает карточку чата без
  повторного участия и без траты лимита ссылки.
"""

from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_user
from api_v1.chats import crud, schemas
from api_v1.events.service import notify_chat, notify_user
from core.i18n import t
from core.models import Chat, ChatInvite, User, db_helper, user_chat_association_table
from core.models.associations import ROLE_CREATOR

router = APIRouter(prefix="/chats", tags=["Chats"])

#: Сколько символов в токене ссылки (token_urlsafe(32) даёт 43).
TOKEN_BYTES = 32
#: Максимум активных ссылок на группу — чтобы «наклепать» их сотнями не вышло.
MAX_ACTIVE_INVITES = 10
#: Сколько активных ссылок показываем в карточке группы.
INVITES_PAGE_SIZE = 20


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_active(invite: ChatInvite, now: datetime) -> bool:
    """Работает ли ссылка прямо сейчас."""
    if invite.revoked:
        return False
    expires_at = invite.expires_at
    if expires_at is not None and expires_at <= now:
        return False
    if invite.max_uses is not None and invite.uses >= invite.max_uses:
        return False
    return True


def _invite_payload(invite: ChatInvite, now: datetime) -> dict:
    return {
        "id": invite.id,
        "token": invite.token,
        "path": f"/j/{invite.token}",
        "created_at": invite.created_at,
        "expires_at": invite.expires_at,
        "max_uses": invite.max_uses,
        "uses": invite.uses,
        "revoked": invite.revoked,
        "active": _is_active(invite, now),
    }


async def _ensure_group_can_invite(
    session: AsyncSession, *, chat_id: int, user_id: int
) -> Chat:
    """Проверяет, что чат — группа, а пользователь может звать по ссылке."""
    chat = await session.get(Chat, chat_id)
    if chat is None or not chat.is_group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=t("Группа не найдена"),
        )
    role = await crud.get_member_role(session=session, chat_id=chat_id, user_id=user_id)
    if role not in ("creator", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=t("Приглашать по ссылке могут создатель и админы"),
        )
    return chat


async def _member_count(session: AsyncSession, chat_id: int) -> int:
    """Сколько человек в группе (для карточки приглашения)."""
    return (
        await session.scalar(
            select(func.count())
            .select_from(user_chat_association_table)
            .where(user_chat_association_table.c.chat_id == chat_id)
        )
    ) or 0


async def _find_invite(session: AsyncSession, token: str) -> ChatInvite:
    """Находит ссылку по токену (без проверки срока и лимита).

    Проверку «действует ли» делаем отдельно и только для тех, кому она реально
    нужна: уже состоящий в группе человек может открыть и «сгоревшую» ссылку —
    ему надо просто попасть в чат, а не получить «ссылка не действует».
    """
    invite = await session.scalar(select(ChatInvite).where(ChatInvite.token == token))
    if invite is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=t("Ссылка не найдена — возможно, её отозвали"),
        )
    return invite


def _ensure_invite_active(invite: ChatInvite) -> None:
    """Отказывает, если ссылкой уже нельзя воспользоваться."""
    if not _is_active(invite, _now()):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=t("Ссылка больше не действует — попросите новую"),
        )


@router.post("/{chat_id}/invites/", response_model=schemas.GroupInvite)
async def create_group_invite(
    chat_id: int,
    payload: schemas.GroupInviteCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Создаёт ссылку-приглашение в группу (создатель/админ)."""
    await _ensure_group_can_invite(session, chat_id=chat_id, user_id=user.id)

    now = _now()
    active = (
        (
            await session.execute(
                select(ChatInvite).where(
                    ChatInvite.chat_id == chat_id, ChatInvite.revoked.is_(False)
                )
            )
        )
        .scalars()
        .all()
    )
    if sum(1 for invite in active if _is_active(invite, now)) >= MAX_ACTIVE_INVITES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Слишком много действующих ссылок — отзовите лишние "
                "или используйте уже созданную"
            ),
        )

    expires_at = (
        now + timedelta(hours=payload.expires_in_hours)
        if payload.expires_in_hours is not None
        else None
    )
    invite = ChatInvite(
        chat_id=chat_id,
        token=token_urlsafe(TOKEN_BYTES),
        created_by=user.id,
        expires_at=expires_at,
        max_uses=payload.max_uses,
    )
    session.add(invite)
    await session.commit()
    await session.refresh(invite)
    return _invite_payload(invite, now)


@router.get("/{chat_id}/invites/", response_model=list[schemas.GroupInvite])
async def list_group_invites(
    chat_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Ссылки группы: сначала действующие, потом отозванные и истёкшие."""
    await _ensure_group_can_invite(session, chat_id=chat_id, user_id=user.id)
    now = _now()
    result = await session.execute(
        select(ChatInvite)
        .where(ChatInvite.chat_id == chat_id)
        .order_by(ChatInvite.created_at.desc())
        .limit(INVITES_PAGE_SIZE)
    )
    invites = list(result.scalars().all())
    invites.sort(key=lambda invite: (not _is_active(invite, now), -invite.id))
    return [_invite_payload(invite, now) for invite in invites]


@router.delete(
    "/{chat_id}/invites/{invite_id}/",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_group_invite(
    chat_id: int,
    invite_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Отзывает ссылку: она сразу перестаёт работать (создатель/админ)."""
    await _ensure_group_can_invite(session, chat_id=chat_id, user_id=user.id)
    invite = await session.get(ChatInvite, invite_id)
    if invite is None or invite.chat_id != chat_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=t("Ссылка не найдена"),
        )
    invite.revoked = True
    await session.commit()


@router.get("/invites/{token}/", response_model=schemas.GroupInvitePreview)
async def preview_group_invite(
    token: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Карточка группы по ссылке — что человек видит до вступления."""
    invite = await _find_invite(session, token)
    chat = await session.get(Chat, invite.chat_id)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=t("Группа больше не существует"),
        )
    is_member = await crud.is_user_chat_member(session, chat.id, user.id)
    # Уже в группе — показываем карточку независимо от состояния ссылки: человеку
    # нужно просто открыть чат.
    if not is_member:
        _ensure_invite_active(invite)
    return {
        "chat_id": chat.id,
        "name": chat.name,
        "description": chat.description,
        "avatar_url": chat.avatar_url,
        "avatar_thumb_url": chat.avatar_thumb_url,
        "member_count": await _member_count(session, chat.id),
        "is_member": is_member,
        "expired": not _is_active(invite, _now()),
    }


@router.post("/invites/{token}/join/", response_model=schemas.GroupJoinResult)
async def join_group_by_invite(
    token: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Вступает в группу по ссылке и возвращает карточку чата."""
    invite = await _find_invite(session, token)
    chat = await session.get(Chat, invite.chat_id)
    if chat is None or not chat.is_group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=t("Группа больше не существует"),
        )
    if chat.e2ee_enabled:
        # Ключ группы выдаёт клиент существующего участника (обёртка в
        # chat_group_keys). Через ссылку обёртки взять не у кого — новый
        # участник не увидел бы ни переписку, ни новые сообщения.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Группа зашифрована: ключ выдаёт участник группы. "
                "Попросите добавить вас вручную"
            ),
        )

    if await crud.is_user_chat_member(session, chat.id, user.id):
        # Уже внутри: лимит ссылки не тратим — просто сообщаем, какой чат открыть.
        return {"chat_id": chat.id, "name": chat.name}

    # Забанен — вход закрыт, сколько бы ссылок ни прислали.
    if await crud.is_chat_banned(session, chat_id=chat.id, user_id=user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=t("Вы забанены в этой группе"),
        )

    # Для нового участника ссылка обязана быть действующей.
    _ensure_invite_active(invite)

    # Занимаем место в лимите ссылки атомарно: если входов больше нет — отказ.
    claimed = await session.execute(
        update(ChatInvite)
        .where(
            ChatInvite.id == invite.id,
            ChatInvite.revoked.is_(False),
            (ChatInvite.max_uses.is_(None)) | (ChatInvite.uses < ChatInvite.max_uses),
        )
        .values(uses=ChatInvite.uses + 1)
    )
    if not claimed.rowcount:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=t("Ссылка больше не действует — попросите новую"),
        )

    added = await crud.add_group_members(
        session=session, chat_id=chat.id, user_ids=[user.id]
    )
    await session.commit()

    if added and chat.creator_id == user.id:
        # Создатель вернулся в свою группу по ссылке: роль снова «создатель».
        # Иначе группа осталась бы без владельца — никто не может ни звать, ни
        # менять состав, ни назначать админов.
        await session.execute(
            update(user_chat_association_table)
            .where(
                user_chat_association_table.c.chat_id == chat.id,
                user_chat_association_table.c.user_id == user.id,
            )
            .values(role=ROLE_CREATOR)
        )
        await session.commit()

    if added:
        # Приглашённому — новый чат в списке; остальным — обновить состав.
        await notify_user(
            user.id,
            {"type": "chat.new", "chat_id": chat.id, "user_id": user.id},
        )
        await notify_chat(
            session,
            chat_id=chat.id,
            payload={
                "type": "chat.updated",
                "chat_id": chat.id,
                "user_id": user.id,
                "action": "members_added",
            },
            exclude_user_id=user.id,
        )

    return {"chat_id": chat.id, "name": chat.name}
