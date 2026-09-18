"""Работа с каналами: создание, подписка, посты, комментарии, предложки.

Канал — это `Chat` с `is_channel=True`, поэтому состав участников, роли
(`creator`/`admin`/`member` → владелец/админ/подписчик), непрочитанные,
приглашения, вложения, реакции и пересылка берутся из готового кода чатов.
Здесь только то, что есть лишь у каналов.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.chats.crud import get_member_role
from api_v1.events.service import dispatch_realtime, notify_chat
from core.models import (
    ChannelComment,
    ChannelPostView,
    ChannelSuggestion,
    Chat,
    ChatBan,
    Message,
    User,
    user_chat_association_table,
)
from core.models.associations import ROLE_ADMIN, ROLE_CREATOR, ROLE_MEMBER
from core.models.channel import (
    SUGGESTION_APPROVED,
    SUGGESTION_PENDING,
    SUGGESTION_REJECTED,
)

logger = logging.getLogger(__name__)

#: Сколько каналов может создать один человек.
CHANNEL_LIMIT_PER_USER = 10
#: Правила публичного адреса канала (`/c/<username>`).
CHANNEL_USERNAME_RE = re.compile(r"^[a-z][a-z0-9_]{3,31}$")
#: Сколько подписчиков отдаём одним ответом (дальше — поиск по списку в клиенте).
SUBSCRIBERS_PAGE = 200


def normalize_channel_username(value: str | None) -> str | None:
    """Проверяет и приводит к нижнему регистру публичный адрес канала."""
    if value is None:
        return None
    username = value.strip().lower().lstrip("@")
    if not username:
        return None
    if not CHANNEL_USERNAME_RE.match(username):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Адрес канала: латиница, цифры и подчёркивание, 4–32 символа, "
                "начинается с буквы"
            ),
        )
    return username


async def _username_taken(
    session: AsyncSession, username: str, *, chat_id: int | None = None
) -> bool:
    stmt = select(Chat.id).where(
        func.lower(Chat.channel_username) == username, Chat.is_channel.is_(True)
    )
    if chat_id is not None:
        stmt = stmt.where(Chat.id != chat_id)
    return await session.scalar(stmt) is not None


async def get_channel_or_404(session: AsyncSession, chat_id: int) -> Chat:
    """Канал по id чата (404 — если это не канал)."""
    chat = await session.scalar(
        select(Chat).where(Chat.id == chat_id, Chat.is_channel.is_(True))
    )
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Канал не найден"
        )
    return chat


async def get_role(session: AsyncSession, chat_id: int, user_id: int) -> str | None:
    """Роль человека в канале (None — не подписан)."""
    return await get_member_role(session, chat_id=chat_id, user_id=user_id)


async def ensure_admin(session: AsyncSession, chat_id: int, user_id: int) -> str:
    """Проверяет, что человек владелец/админ канала (иначе 403)."""
    role = await get_role(session, chat_id, user_id)
    if role not in (ROLE_CREATOR, ROLE_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нужны права администратора канала",
        )
    return role


async def ensure_can_post(session: AsyncSession, chat_id: int, user_id: int) -> None:
    """Проверяет право писать в ленту канала.

    В канале публикуют только владелец и админы: подписчики читают и могут
    предложить пост на одобрение (см. `create_suggestion`). Для обычных чатов
    проверка ничего не делает.
    """
    is_channel = await session.scalar(select(Chat.is_channel).where(Chat.id == chat_id))
    if not is_channel:
        return
    role = await get_member_role(session, chat_id=chat_id, user_id=user_id)
    if role in (ROLE_CREATOR, ROLE_ADMIN):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="В канале публикуют владелец и админы. Можно предложить пост.",
    )


async def count_created_channels(session: AsyncSession, user_id: int) -> int:
    """Сколько каналов человек уже создал (лимит на аккаунт)."""
    stmt = (
        select(func.count())
        .select_from(Chat)
        .where(Chat.is_channel.is_(True), Chat.creator_id == user_id)
    )
    return int(await session.scalar(stmt) or 0)


async def create_channel(
    session: AsyncSession,
    *,
    owner_id: int,
    title: str,
    description: str | None = None,
    is_public: bool = False,
    username: str | None = None,
) -> Chat:
    """Создаёт канал: владелец сразу подписан, остальные приходят сами."""
    if await count_created_channels(session, owner_id) >= CHANNEL_LIMIT_PER_USER:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Лимит: не больше {CHANNEL_LIMIT_PER_USER} каналов на аккаунт",
        )

    alias = normalize_channel_username(username) if is_public else None
    if is_public and alias is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Для публичного канала нужен адрес (ссылка /c/…)",
        )
    if alias is not None and await _username_taken(session, alias):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Такой адрес канала уже занят",
        )

    chat = Chat(
        name=title.strip() or "Канал",
        description=(description or "").strip() or None,
        # Канал — это чат: группы и каналы используют один и тот же механизм
        # участников, ролей и приглашений.
        is_group=True,
        is_channel=True,
        creator_id=owner_id,
        channel_username=alias,
        is_public=bool(is_public and alias),
    )
    session.add(chat)
    await session.flush()
    await session.execute(
        user_chat_association_table.insert(),
        [
            {
                "chat_id": chat.id,
                "user_id": owner_id,
                "role": ROLE_CREATOR,
            }
        ],
    )
    await session.commit()
    return chat


async def update_channel(
    session: AsyncSession,
    *,
    chat: Chat,
    user_id: int,
    title: str | None = None,
    description: str | None = None,
    is_public: bool | None = None,
    username: str | None = None,
) -> Chat:
    """Меняет настройки канала (владелец/админ — проверяет роутер)."""
    await ensure_admin(session, chat.id, user_id)
    if title is not None:
        stripped = title.strip()
        if stripped:
            chat.name = stripped
    if description is not None:
        chat.description = description.strip() or None

    # Публичность и адрес меняются вместе: адрес нужен только публичному каналу.
    if is_public is not None or username is not None:
        public = chat.is_public if is_public is None else is_public
        alias = (
            normalize_channel_username(username)
            if username is not None
            else chat.channel_username
        )
        if public and alias is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Для публичного канала нужен адрес (ссылка /c/…)",
            )
        if alias is not None and await _username_taken(session, alias, chat_id=chat.id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Такой адрес канала уже занят",
            )
        chat.is_public = public
        chat.channel_username = alias

    await session.commit()
    return chat


async def _subscribers_count(session: AsyncSession, chat_id: int) -> int:
    stmt = (
        select(func.count())
        .select_from(user_chat_association_table)
        .where(user_chat_association_table.c.chat_id == chat_id)
    )
    return int(await session.scalar(stmt) or 0)


async def _posts_count(session: AsyncSession, chat_id: int) -> int:
    stmt = (
        select(func.count())
        .select_from(Message)
        .where(Message.chat_id == chat_id, Message.kind.is_(None))
    )
    return int(await session.scalar(stmt) or 0)


async def channel_card(
    session: AsyncSession, chat: Chat, user_id: int | None
) -> dict[str, Any]:
    """Карточка канала: описание, счётчики и моя роль."""
    owner_name = None
    if chat.creator_id is not None:
        owner = await session.get(User, chat.creator_id)
        if owner is not None:
            owner_name = owner.first_name or owner.username
    role = await get_role(session, chat.id, user_id) if user_id else None
    return {
        "id": chat.id,
        "title": chat.name,
        "description": chat.description,
        "username": chat.channel_username,
        "is_public": bool(chat.is_public),
        "avatar_url": chat.avatar_url,
        "avatar_thumb_url": chat.avatar_thumb_url,
        "subscribers": await _subscribers_count(session, chat.id),
        "posts": await _posts_count(session, chat.id),
        "role": role,
        "owner_name": owner_name,
    }


async def list_my_channels(session: AsyncSession, user_id: int) -> list[dict[str, Any]]:
    """Каналы, где я владелец или админ (для экрана «Мои каналы»)."""
    stmt = (
        select(Chat)
        .join(
            user_chat_association_table,
            user_chat_association_table.c.chat_id == Chat.id,
        )
        .where(
            Chat.is_channel.is_(True),
            user_chat_association_table.c.user_id == user_id,
            user_chat_association_table.c.role.in_((ROLE_CREATOR, ROLE_ADMIN)),
        )
        .order_by(Chat.id.desc())
    )
    chats = list((await session.execute(stmt)).scalars().all())
    return [await channel_card(session, chat, user_id) for chat in chats]


async def search_public_channels(
    session: AsyncSession, *, query: str, user_id: int, limit: int = 30
) -> list[dict[str, Any]]:
    """Поиск публичных каналов по адресу и названию."""
    text = query.strip().lstrip("@").lower()
    if not text:
        return []
    pattern = f"%{text}%"
    stmt = (
        select(Chat)
        .where(
            Chat.is_channel.is_(True),
            Chat.is_public.is_(True),
            Chat.channel_username.is_not(None),
            or_(
                func.lower(Chat.channel_username).like(pattern),
                func.lower(Chat.name).like(pattern),
            ),
        )
        .order_by(Chat.id.desc())
        .limit(limit)
    )
    chats = list((await session.execute(stmt)).scalars().all())
    return [await channel_card(session, chat, user_id) for chat in chats]


async def find_public_channel_by_username(
    session: AsyncSession, username: str
) -> Chat | None:
    """Канал по публичному адресу (ссылка `/c/<username>`)."""
    alias = normalize_channel_username(username)
    if alias is None:
        return None
    return await session.scalar(
        select(Chat).where(
            Chat.is_channel.is_(True),
            Chat.is_public.is_(True),
            func.lower(Chat.channel_username) == alias,
        )
    )


async def join_channel(session: AsyncSession, *, chat: Chat, user_id: int) -> None:
    """Подписка на канал (приватный — по ссылке-приглашению, см. chats)."""
    role = await get_role(session, chat.id, user_id)
    if role is not None:
        return
    # Забаненный подписаться не может: иначе бан в канале ничего не значил.
    banned = await session.scalar(
        select(ChatBan.id).where(ChatBan.chat_id == chat.id, ChatBan.user_id == user_id)
    )
    if banned is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Вы забанены в этом канале",
        )
    await session.execute(
        user_chat_association_table.insert(),
        [{"chat_id": chat.id, "user_id": user_id, "role": ROLE_MEMBER}],
    )
    await session.commit()


async def leave_channel(session: AsyncSession, *, chat: Chat, user_id: int) -> None:
    """Отписка: владелец уйти не может — он удаляет канал."""
    role = await get_role(session, chat.id, user_id)
    if role is None:
        return
    if role == ROLE_CREATOR:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Владелец не может отписаться: удалите канал или передайте права",
        )
    await session.execute(
        delete(user_chat_association_table).where(
            user_chat_association_table.c.chat_id == chat.id,
            user_chat_association_table.c.user_id == user_id,
        )
    )
    await session.commit()
    await _notify_chat_admins(
        session,
        chat_id=chat.id,
        payload={"type": "channel.subscribers", "chat_id": chat.id},
    )


async def list_subscribers(
    session: AsyncSession, chat_id: int, *, limit: int = SUBSCRIBERS_PAGE
) -> list[dict[str, Any]]:
    """Подписчики канала (для экрана «Подписчики»)."""
    stmt = (
        select(
            User,
            user_chat_association_table.c.role,
            user_chat_association_table.c.joined_at,
        )
        .join(
            user_chat_association_table,
            user_chat_association_table.c.user_id == User.id,
        )
        .where(user_chat_association_table.c.chat_id == chat_id)
        .order_by(
            user_chat_association_table.c.role != ROLE_CREATOR,
            user_chat_association_table.c.role != ROLE_ADMIN,
            User.id,
        )
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "id": user.id,
            "username": user.username,
            "name": user.first_name or user.username,
            "avatar_url": user.avatar_url,
            "role": role,
            "joined_at": joined_at,
        }
        for user, role, joined_at in rows
    ]


async def set_admin(
    session: AsyncSession, *, chat: Chat, owner_id: int, target_id: int, admin: bool
) -> None:
    """Назначает/снимает админа (только владелец)."""
    if chat.creator_id != owner_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Назначать админов может только владелец канала",
        )
    role = await get_role(session, chat.id, target_id)
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Он не подписан на канал"
        )
    if role == ROLE_CREATOR:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Владельца нельзя назначить или снять админом",
        )
    new_role = ROLE_ADMIN if admin else ROLE_MEMBER
    if role == new_role:
        return
    await session.execute(
        user_chat_association_table.update()
        .where(
            user_chat_association_table.c.chat_id == chat.id,
            user_chat_association_table.c.user_id == target_id,
        )
        .values(role=new_role)
    )
    await session.commit()
    await dispatch_realtime(
        [target_id],
        {
            "type": "channel.role",
            "chat_id": chat.id,
            "role": new_role,
        },
    )


# ---------- Комментарии и просмотры ----------


async def comments_counts(
    session: AsyncSession, message_ids: list[int]
) -> dict[int, int]:
    """Сколько комментариев у каждого поста (одним запросом)."""
    if not message_ids:
        return {}
    stmt = (
        select(ChannelComment.message_id, func.count(ChannelComment.id))
        .where(ChannelComment.message_id.in_(message_ids))
        .group_by(ChannelComment.message_id)
    )
    return {int(mid): int(count) for mid, count in (await session.execute(stmt)).all()}


async def views_counts(session: AsyncSession, message_ids: list[int]) -> dict[int, int]:
    """Сколько просмотров у каждого поста (одним запросом)."""
    if not message_ids:
        return {}
    stmt = (
        select(ChannelPostView.message_id, func.count(ChannelPostView.id))
        .where(ChannelPostView.message_id.in_(message_ids))
        .group_by(ChannelPostView.message_id)
    )
    return {int(mid): int(count) for mid, count in (await session.execute(stmt)).all()}


async def list_comments(
    session: AsyncSession, *, chat_id: int, message_id: int, user_id: int
) -> list[dict[str, Any]]:
    """Комментарии под постом (по возрастанию времени)."""
    is_admin = (await get_role(session, chat_id, user_id)) in (
        ROLE_CREATOR,
        ROLE_ADMIN,
    )
    stmt = (
        select(ChannelComment, User)
        .join(User, User.id == ChannelComment.user_id)
        .where(
            ChannelComment.chat_id == chat_id,
            ChannelComment.message_id == message_id,
        )
        .order_by(ChannelComment.id)
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "id": comment.id,
            "message_id": comment.message_id,
            "user_id": comment.user_id,
            "name": user.first_name or user.username,
            "username": user.username,
            "avatar_url": user.avatar_url,
            "text": comment.text,
            "created_at": comment.created_at,
            "can_delete": is_admin or comment.user_id == user_id,
        }
        for comment, user in rows
    ]


async def add_comment(
    session: AsyncSession, *, chat: Chat, message_id: int, user_id: int, text: str
) -> dict[str, Any]:
    """Комментирует пост (подписчики тоже могут) и уведомляет автора поста."""
    post = await session.scalar(
        select(Message).where(Message.id == message_id, Message.chat_id == chat.id)
    )
    if post is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Пост не найден"
        )
    comment = ChannelComment(
        chat_id=chat.id, message_id=message_id, user_id=user_id, text=text.strip()
    )
    session.add(comment)
    await session.commit()
    # Автору поста (владельцу/админу) — тихое событие: комментарий должен
    # появиться сразу, но push на каждый комментарий не шлём (иначе спам).
    if post.user_id != user_id:
        await dispatch_realtime(
            [post.user_id],
            {
                "type": "channel.comment",
                "chat_id": chat.id,
                "message_id": message_id,
                "comment_id": comment.id,
            },
        )
    author = await session.get(User, user_id)
    return {
        "id": comment.id,
        "message_id": comment.message_id,
        "user_id": user_id,
        "name": (author.first_name or author.username) if author else "",
        "username": author.username if author else "",
        "avatar_url": author.avatar_url if author else None,
        "text": comment.text,
        "created_at": comment.created_at,
        "can_delete": True,
    }


async def delete_comment(
    session: AsyncSession, *, chat_id: int, comment_id: int, user_id: int
) -> None:
    """Удаляет комментарий: свой, или владелец/админ канала."""
    comment = await session.scalar(
        select(ChannelComment).where(
            ChannelComment.id == comment_id, ChannelComment.chat_id == chat_id
        )
    )
    if comment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Комментарий не найден"
        )
    if comment.user_id != user_id:
        await ensure_admin(session, chat_id, user_id)
    await session.delete(comment)
    await session.commit()


async def mark_post_view(
    session: AsyncSession, *, chat_id: int, message_id: int, user_id: int
) -> None:
    """Отмечает просмотр поста (повторные открытия счётчик не накручивают)."""
    exists = await session.scalar(
        select(ChannelPostView.id).where(
            ChannelPostView.message_id == message_id,
            ChannelPostView.user_id == user_id,
        )
    )
    if exists:
        return
    post_exists = await session.scalar(
        select(Message.id).where(Message.id == message_id, Message.chat_id == chat_id)
    )
    if post_exists is None:
        return
    session.add(ChannelPostView(message_id=message_id, user_id=user_id))
    await session.commit()


# ---------- Предложенные посты ----------


async def create_suggestion(
    session: AsyncSession, *, chat: Chat, user_id: int, text: str
) -> ChannelSuggestion:
    """Подписчик предлагает пост: публикует его владелец/админ после проверки."""
    if await get_role(session, chat.id, user_id) is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Вы не подписаны на канал"
        )
    suggestion = ChannelSuggestion(
        chat_id=chat.id, author_id=user_id, text=text.strip(), status=SUGGESTION_PENDING
    )
    session.add(suggestion)
    await session.commit()
    await _notify_chat_admins(
        session,
        chat_id=chat.id,
        payload={
            "type": "channel.suggestion",
            "chat_id": chat.id,
            "suggestion_id": suggestion.id,
        },
    )
    return suggestion


async def list_suggestions(
    session: AsyncSession, *, chat: Chat, user_id: int, statuses: tuple[str, ...]
) -> list[dict[str, Any]]:
    """Предложенные посты канала: владельцу/админу — все, автору — свои."""
    role = await get_role(session, chat.id, user_id)
    if role in (ROLE_CREATOR, ROLE_ADMIN):
        condition = ChannelSuggestion.chat_id == chat.id
    else:
        condition = (ChannelSuggestion.chat_id == chat.id) & (
            ChannelSuggestion.author_id == user_id
        )
    stmt = (
        select(ChannelSuggestion, User)
        .join(User, User.id == ChannelSuggestion.author_id)
        .where(condition, ChannelSuggestion.status.in_(statuses))
        .order_by(ChannelSuggestion.id.desc())
        .limit(100)
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "id": suggestion.id,
            "chat_id": suggestion.chat_id,
            "author_id": suggestion.author_id,
            "author_name": user.first_name or user.username,
            "text": suggestion.text,
            "status": suggestion.status,
            "message_id": suggestion.message_id,
            "created_at": suggestion.created_at,
        }
        for suggestion, user in rows
    ]


async def _publish_post(
    session: AsyncSession, *, chat_id: int, author_id: int, text: str
) -> Message:
    """Публикует пост в канале от имени владельца/админа и рассылает событие."""
    message = Message(text=text, chat_id=chat_id, user_id=author_id)
    session.add(message)
    await session.commit()
    await notify_chat(
        session,
        chat_id=chat_id,
        payload={
            "type": "message.new",
            "chat_id": chat_id,
            "message_id": message.id,
            "sender_id": author_id,
        },
        exclude_user_id=author_id,
    )
    return message


async def review_suggestion(
    session: AsyncSession,
    *,
    chat: Chat,
    suggestion_id: int,
    reviewer_id: int,
    approve: bool,
) -> ChannelSuggestion:
    """Одобряет (публикует пост) или отклоняет предложенный пост."""
    await ensure_admin(session, chat.id, reviewer_id)
    suggestion = await session.scalar(
        select(ChannelSuggestion).where(
            ChannelSuggestion.id == suggestion_id,
            ChannelSuggestion.chat_id == chat.id,
        )
    )
    if suggestion is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Предложение не найдено"
        )
    if suggestion.status != SUGGESTION_PENDING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Предложение уже рассмотрено"
        )

    if approve:
        message = await _publish_post(
            session, chat_id=chat.id, author_id=reviewer_id, text=suggestion.text
        )
        suggestion.message_id = message.id
        suggestion.status = SUGGESTION_APPROVED
    else:
        suggestion.status = SUGGESTION_REJECTED
    suggestion.reviewed_at = datetime.now(timezone.utc)
    suggestion.reviewed_by = reviewer_id
    await session.commit()

    # Автору предложки — тихое событие: по нему в интерфейсе виден исход.
    await dispatch_realtime(
        [suggestion.author_id],
        {
            "type": "channel.suggestion-reviewed",
            "chat_id": chat.id,
            "suggestion_id": suggestion.id,
            "status": suggestion.status,
            "message_id": suggestion.message_id,
        },
    )
    return suggestion


async def _notify_chat_admins(
    session: AsyncSession, *, chat_id: int, payload: dict[str, Any]
) -> None:
    """Тихие события владельцу и админам канала (без push)."""
    stmt = select(user_chat_association_table.c.user_id).where(
        user_chat_association_table.c.chat_id == chat_id,
        user_chat_association_table.c.role.in_((ROLE_CREATOR, ROLE_ADMIN)),
    )
    for user_id in (await session.execute(stmt)).scalars().all():
        await dispatch_realtime([user_id], payload)


async def users_by_ids(session: AsyncSession, ids: list[int]) -> list[User]:
    """Пользователи по id (для карточек подписчиков и админов)."""
    if not ids:
        return []
    stmt = select(User).where(User.id.in_(ids))
    return list((await session.execute(stmt)).scalars().all())


__all__ = [
    "CHANNEL_LIMIT_PER_USER",
    "add_comment",
    "channel_card",
    "comments_counts",
    "count_created_channels",
    "create_channel",
    "create_suggestion",
    "delete_comment",
    "ensure_admin",
    "ensure_can_post",
    "find_public_channel_by_username",
    "get_channel_or_404",
    "get_role",
    "join_channel",
    "leave_channel",
    "list_comments",
    "list_my_channels",
    "list_subscribers",
    "list_suggestions",
    "mark_post_view",
    "normalize_channel_username",
    "review_suggestion",
    "search_public_channels",
    "set_admin",
    "update_channel",
    "users_by_ids",
    "views_counts",
]
