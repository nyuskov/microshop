from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_user
from api_v1.chats import crud
from api_v1.chats.schemas import Chat as ChatSchema
from api_v1.chats.schemas import ChatUserSchema, PrivateChatCreate
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
) -> dict:
    """Преобразует чат в словарь для ответа API."""
    last = last_messages.get(chat.id)
    return {
        "id": chat.id,
        "name": chat.name,
        "users": [ChatUserSchema.model_validate(u) for u in chat.users],
        "last_message": (
            message_basic_to_dict(last) if last is not None else None
        ),
        "unread_count": unread_counts.get(chat.id, 0),
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
    chat_ids = [chat.id for chat in chats]
    last_messages = await crud.get_last_messages(
        session=session, chat_ids=chat_ids
    )
    unread_counts = await crud.get_unread_counts(
        session=session, chat_ids=chat_ids, user_id=user.id
    )
    items = [
        _serialize_chat(chat, last_messages, unread_counts) for chat in chats
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
    last_messages = await crud.get_last_messages(
        session=session, chat_ids=[chat.id]
    )
    unread_counts = await crud.get_unread_counts(
        session=session, chat_ids=[chat.id], user_id=user.id
    )
    return _serialize_chat(chat, last_messages, unread_counts)
