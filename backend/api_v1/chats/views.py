from datetime import datetime

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_user, touch_last_seen
from api_v1.chats import crud
from api_v1.chats.schemas import Chat as ChatSchema
from api_v1.chats.schemas import ChatE2eeUpdate, ChatUserSchema, PrivateChatCreate
from api_v1.messages.crud import message_basic_to_dict
from core.models import Chat, Message, User, db_helper

router = APIRouter(
    prefix="/chats",
    tags=["Chats"],
)


def _serialize_chat(
    chat: Chat,
    last_messages: dict[int, Message],
    unread_counts: dict[int, int],
    muted_ids: set[int],
) -> dict:
    """Преобразует чат в словарь для ответа API."""
    last = last_messages.get(chat.id)
    return {
        "id": chat.id,
        "name": chat.name,
        "users": [ChatUserSchema.model_validate(u) for u in chat.users],
        "last_message": (message_basic_to_dict(last) if last is not None else None),
        "unread_count": unread_counts.get(chat.id, 0),
        "muted": chat.id in muted_ids,
        "e2ee_enabled": chat.e2ee_enabled,
        "is_self": chat.is_self,
    }


def _chat_sort_key(item: dict):
    """Ключ сортировки: чаты с сообщениями сначала, новые — выше."""
    last = item.get("last_message")
    if last is None:
        return (1, datetime.min)
    return (0, last["timestamp"])


@router.get("/", response_model=list[ChatSchema])
async def get_my_chats(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Возвращает чаты текущего пользователя с последними сообщениями."""
    chats = await crud.get_user_chats(session=session, user_id=user.id)
    # «Сохранённые сообщения» (чат с собой) есть всегда и приходит в списке.
    self_chat = await crud.get_or_create_self_chat(session=session, user=user)
    if self_chat.id not in {chat.id for chat in chats}:
        chats = [self_chat, *chats]
    # Фронт поллит именно этот эндпоинт каждые ~3 c — здесь и обновляем присутствие.
    await touch_last_seen(user, session)
    chat_ids = [chat.id for chat in chats]
    last_messages = await crud.get_last_messages(session=session, chat_ids=chat_ids)
    unread_counts = await crud.get_unread_counts(
        session=session, chat_ids=chat_ids, user_id=user.id
    )
    muted_ids = await crud.get_muted_chat_ids(
        session=session, user_id=user.id, chat_ids=chat_ids
    )
    items = [
        _serialize_chat(chat, last_messages, unread_counts, muted_ids) for chat in chats
    ]
    items.sort(key=_chat_sort_key, reverse=True)
    return items


@router.post("/private/", response_model=ChatSchema)
async def create_or_open_private_chat(
    payload: PrivateChatCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Находит или создаёт личный чат текущего пользователя с собеседником."""
    chat = await crud.get_or_create_private_chat(
        session=session,
        first_user_id=user.id,
        second_user_id=payload.user_id,
    )
    last_messages = await crud.get_last_messages(session=session, chat_ids=[chat.id])
    unread_counts = await crud.get_unread_counts(
        session=session, chat_ids=[chat.id], user_id=user.id
    )
    muted_ids = await crud.get_muted_chat_ids(
        session=session, user_id=user.id, chat_ids=[chat.id]
    )
    return _serialize_chat(chat, last_messages, unread_counts, muted_ids)


@router.put("/{chat_id}/e2ee/")
async def set_chat_e2ee_mode(
    chat_id: int,
    payload: ChatE2eeUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, bool]:
    """Переключает тип чата: обычный (False) / зашифрованный E2EE (True)."""
    enabled = await crud.set_chat_e2ee(
        session=session,
        chat_id=chat_id,
        user_id=user.id,
        enabled=payload.enabled,
    )
    return {"e2ee_enabled": enabled}


@router.put("/{chat_id}/mute/")
async def mute_chat(
    chat_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, bool]:
    """Заглушает уведомления чата для текущего пользователя."""
    muted = await crud.set_chat_muted(
        session=session, chat_id=chat_id, user_id=user.id, muted=True
    )
    return {"muted": muted}


@router.delete("/{chat_id}/mute/")
async def unmute_chat(
    chat_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, bool]:
    """Возобновляет уведомления чата для текущего пользователя."""
    muted = await crud.set_chat_muted(
        session=session, chat_id=chat_id, user_id=user.id, muted=False
    )
    return {"muted": muted}


@router.delete("/{chat_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat(
    chat_id: int,
    for_all: bool = Query(default=False),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Удаляет чат: только у себя (по умолчанию) либо для всех участников."""
    await crud.leave_chat(
        session=session, chat_id=chat_id, user_id=user.id, for_all=for_all
    )
    return None
