"""REST-эндпоинты каналов: создание, подписка, посты, комментарии, предложки."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_user
from core.models import Chat, User, db_helper

from . import crud
from .schemas import (
    AdminChange,
    ChannelCard,
    ChannelCreate,
    ChannelUpdate,
    CommentCreate,
    CommentOut,
    PostMeta,
    SubscriberOut,
    SuggestionCreate,
    SuggestionOut,
)

router = APIRouter(prefix="/channels", tags=["Channels"])

#: Статусы для фильтра списка предложек.
PENDING = ("pending",)
ALL_STATUSES = ("pending", "approved", "rejected")


@router.post("/", response_model=ChannelCard, status_code=status.HTTP_201_CREATED)
async def create_channel(
    payload: ChannelCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, Any]:
    """Создаёт канал: «у каждого пользователя» свои каналы, до 10 на аккаунт."""
    chat = await crud.create_channel(
        session,
        owner_id=user.id,
        title=payload.title,
        description=payload.description,
        is_public=payload.is_public,
        username=payload.username,
    )
    return await crud.channel_card(session, chat, user.id)


@router.get("/mine/", response_model=list[ChannelCard])
async def my_channels(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[dict[str, Any]]:
    """Каналы, где я владелец или админ (для управления)."""
    return await crud.list_my_channels(session, user.id)


@router.get("/search/", response_model=list[ChannelCard])
async def search_channels(
    q: str = Query(default="", max_length=64),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[dict[str, Any]]:
    """Поиск публичных каналов по адресу (@username) и названию."""
    return await crud.search_public_channels(session, query=q, user_id=user.id)


async def _channel(session: AsyncSession, chat_id: int) -> Chat:
    return await crud.get_channel_or_404(session, chat_id)


@router.get("/by-username/{username}/", response_model=ChannelCard)
async def channel_by_username(
    username: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, Any]:
    """Публичный канал по ссылке `/c/<username>` (экран подписки)."""
    chat = await crud.find_public_channel_by_username(session, username)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Канал не найден"
        )
    return await crud.channel_card(session, chat, user.id)


@router.get("/{chat_id}/", response_model=ChannelCard)
async def channel_card(
    chat_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, Any]:
    """Карточка канала (для шапки/настроек/экрана подписки)."""
    return await crud.channel_card(session, await _channel(session, chat_id), user.id)


@router.patch("/{chat_id}/", response_model=ChannelCard)
async def update_channel(
    chat_id: int,
    payload: ChannelUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, Any]:
    """Меняет название, описание, публичность и адрес (владелец/админ)."""
    chat = await crud.update_channel(
        session,
        chat=await _channel(session, chat_id),
        user_id=user.id,
        title=payload.title,
        description=payload.description,
        is_public=payload.is_public,
        username=payload.username,
    )
    return await crud.channel_card(session, chat, user.id)


@router.post("/{chat_id}/join/", response_model=ChannelCard)
async def join_channel(
    chat_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, Any]:
    """Подписка на публичный канал (в приватный — по ссылке-приглашению)."""
    chat = await _channel(session, chat_id)
    if not chat.is_public:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Приватный канал: вход только по ссылке-приглашению",
        )
    await crud.join_channel(session, chat=chat, user_id=user.id)
    return await crud.channel_card(session, chat, user.id)


@router.post("/{chat_id}/leave/", status_code=status.HTTP_204_NO_CONTENT)
async def leave_channel(
    chat_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Отписка от канала (владелец — не может, он удаляет канал)."""
    await crud.leave_channel(
        session, chat=await _channel(session, chat_id), user_id=user.id
    )


@router.get("/{chat_id}/subscribers/", response_model=list[SubscriberOut])
async def subscribers(
    chat_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[dict[str, Any]]:
    """Список подписчиков (владелец/админ)."""
    await crud.ensure_admin(session, chat_id, user.id)
    return await crud.list_subscribers(session, chat_id)


@router.post("/{chat_id}/admins/", status_code=status.HTTP_204_NO_CONTENT)
async def set_admin(
    chat_id: int,
    payload: AdminChange,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Назначает или снимает админа канала (только владелец)."""
    await crud.set_admin(
        session,
        chat=await _channel(session, chat_id),
        owner_id=user.id,
        target_id=payload.user_id,
        admin=payload.admin,
    )


# ---------- Посты: счётчики, комментарии ----------


@router.get("/{chat_id}/posts/meta/", response_model=list[PostMeta])
async def posts_meta(
    chat_id: int,
    ids: str = Query(default="", max_length=2048),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[dict[str, Any]]:
    """Счётчики (просмотры/комментарии) для списка постов — одним запросом.

    Нужно ленте канала: под каждым постом видно «N просмотров · M комментариев».
    """
    await crud.get_channel_or_404(session, chat_id)
    message_ids = []
    for chunk in ids.split(","):
        chunk = chunk.strip()
        if chunk.isdigit():
            message_ids.append(int(chunk))
    message_ids = message_ids[:200]
    comments = await crud.comments_counts(session, message_ids)
    views = await crud.views_counts(session, message_ids)
    return [
        {
            "message_id": mid,
            "views": views.get(mid, 0),
            "comments": comments.get(mid, 0),
        }
        for mid in message_ids
    ]


@router.post(
    "/{chat_id}/posts/{message_id}/view/", status_code=status.HTTP_204_NO_CONTENT
)
async def post_view(
    chat_id: int,
    message_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Отмечает, что пост просмотрен (счётчик «просмотров» у поста)."""
    await crud.get_channel_or_404(session, chat_id)
    await crud.mark_post_view(
        session, chat_id=chat_id, message_id=message_id, user_id=user.id
    )


@router.get("/{chat_id}/posts/{message_id}/comments/", response_model=list[CommentOut])
async def post_comments(
    chat_id: int,
    message_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[dict[str, Any]]:
    """Комментарии под постом."""
    await crud.get_channel_or_404(session, chat_id)
    return await crud.list_comments(
        session, chat_id=chat_id, message_id=message_id, user_id=user.id
    )


@router.post(
    "/{chat_id}/posts/{message_id}/comments/",
    response_model=CommentOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_comment(
    chat_id: int,
    message_id: int,
    payload: CommentCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, Any]:
    """Оставляет комментарий под постом (подписчики тоже могут)."""
    chat = await _channel(session, chat_id)
    if await crud.get_role(session, chat_id, user.id) is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Вы не подписаны на канал"
        )
    return await crud.add_comment(
        session, chat=chat, message_id=message_id, user_id=user.id, text=payload.text
    )


@router.delete(
    "/{chat_id}/comments/{comment_id}/", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_comment(
    chat_id: int,
    comment_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Удаляет комментарий: свой или (владелец/админ) любой."""
    await crud.get_channel_or_404(session, chat_id)
    await crud.delete_comment(
        session, chat_id=chat_id, comment_id=comment_id, user_id=user.id
    )


# ---------- Предложенные посты ----------


@router.post(
    "/{chat_id}/suggestions/",
    response_model=SuggestionOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_suggestion(
    chat_id: int,
    payload: SuggestionCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> SuggestionOut:
    """Подписчик предлагает пост: публикует владелец/админ после одобрения."""
    suggestion = await crud.create_suggestion(
        session,
        chat=await _channel(session, chat_id),
        user_id=user.id,
        text=payload.text,
    )
    author = user
    return SuggestionOut(
        id=suggestion.id,
        chat_id=suggestion.chat_id,
        author_id=suggestion.author_id,
        author_name=author.first_name or author.username,
        text=suggestion.text,
        status=suggestion.status,
        message_id=suggestion.message_id,
        created_at=suggestion.created_at,
    )


@router.get("/{chat_id}/suggestions/", response_model=list[SuggestionOut])
async def list_suggestions(
    chat_id: int,
    only_pending: bool = Query(default=True),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[dict[str, Any]]:
    """Список предложенных постов: админам — все, автору — свои."""
    chat = await _channel(session, chat_id)
    statuses = PENDING if only_pending else ALL_STATUSES
    return await crud.list_suggestions(
        session, chat=chat, user_id=user.id, statuses=statuses
    )


@router.post(
    "/{chat_id}/suggestions/{suggestion_id}/approve/", response_model=SuggestionOut
)
async def approve_suggestion(
    chat_id: int,
    suggestion_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, Any]:
    """Одобряет предложку: текст публикуется в канале от имени админа."""
    suggestion = await crud.review_suggestion(
        session,
        chat=await _channel(session, chat_id),
        suggestion_id=suggestion_id,
        reviewer_id=user.id,
        approve=True,
    )
    return {
        "id": suggestion.id,
        "chat_id": suggestion.chat_id,
        "author_id": suggestion.author_id,
        "author_name": "",
        "text": suggestion.text,
        "status": suggestion.status,
        "message_id": suggestion.message_id,
        "created_at": suggestion.created_at,
    }


@router.post(
    "/{chat_id}/suggestions/{suggestion_id}/reject/", response_model=SuggestionOut
)
async def reject_suggestion(
    chat_id: int,
    suggestion_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, Any]:
    """Отклоняет предложку (автору приходит событие с исходом)."""
    suggestion = await crud.review_suggestion(
        session,
        chat=await _channel(session, chat_id),
        suggestion_id=suggestion_id,
        reviewer_id=user.id,
        approve=False,
    )
    return {
        "id": suggestion.id,
        "chat_id": suggestion.chat_id,
        "author_id": suggestion.author_id,
        "author_name": "",
        "text": suggestion.text,
        "status": suggestion.status,
        "message_id": suggestion.message_id,
        "created_at": suggestion.created_at,
    }
