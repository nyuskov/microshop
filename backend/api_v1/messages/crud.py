"""CRUD-операции для сообщений."""

from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api_v1.chats.crud import is_user_chat_member
from api_v1.events.service import notify_chat
from core.models import Chat, Message, MessageReaction, user_chat_association_table

_NOT_MEMBER_DETAIL = "Вы не являетесь участником этого чата"

# Каталог вложений сообщений (файлы сообщений, не аватары).
MEDIA_DIR = Path(__file__).resolve().parent.parent.parent / "media"


def _file_payload(message: Message) -> dict | None:
    """Возвращает данные вложения либо None."""
    if not message.file_name:
        return None
    return {
        "name": message.file_name,
        "url": message.file_url,
        "mime": message.mime_type,
        "size": message.file_size,
    }


def _reactions_payload(reactions: list[MessageReaction], user_id: int) -> list[dict]:
    """Агрегирует реакции по эмодзи."""
    aggregated: dict[str, dict] = {}
    for reaction in reactions:
        item = aggregated.setdefault(
            reaction.emoji,
            {"emoji": reaction.emoji, "count": 0, "reacted_by_me": False},
        )
        item["count"] += 1
        if reaction.user_id == user_id:
            item["reacted_by_me"] = True
    return list(aggregated.values())


def message_to_dict(message: Message, user_id: int) -> dict:
    """Преобразует сообщение (с загруженными реакциями) в словарь для API."""
    return {
        "id": message.id,
        "chat_id": message.chat_id,
        "user_id": message.user_id,
        "text": message.text,
        "timestamp": message.timestamp,
        "reply_to_id": message.reply_to_id,
        "is_read": message.is_read,
        "is_pinned": message.is_pinned,
        "file": _file_payload(message),
        "reactions": _reactions_payload(message.reactions, user_id),
    }


def message_basic_to_dict(message: Message) -> dict:
    """Компактное представление сообщения (без реакций) для списка чатов."""
    return {
        "id": message.id,
        "chat_id": message.chat_id,
        "user_id": message.user_id,
        "text": message.text,
        "timestamp": message.timestamp,
        "reply_to_id": message.reply_to_id,
        "is_read": message.is_read,
        "is_pinned": message.is_pinned,
        "file": _file_payload(message),
        "reactions": [],
    }


async def _load_message(session: AsyncSession, message_id: int) -> Message | None:
    """Загружает сообщение вместе с реакциями."""
    stmt = (
        select(Message)
        .where(Message.id == message_id)
        .options(selectinload(Message.reactions))
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def _reload_and_serialize(
    session: AsyncSession, message_id: int, user_id: int
) -> dict:
    """Перезагружает сообщение после изменений и возвращает словарь API."""
    message = await _load_message(session, message_id)
    if message is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не удалось загрузить сообщение",
        )
    return message_to_dict(message, user_id)


async def _ensure_chat_member_or_404(
    session: AsyncSession, chat_id: int, user_id: int
) -> Chat:
    """Проверяет существование чата и членство пользователя в нём."""
    chat = await session.get(Chat, chat_id)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Чат не найден",
        )
    if not await is_user_chat_member(session, chat_id=chat_id, user_id=user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_NOT_MEMBER_DETAIL,
        )
    return chat


async def _get_member_message(
    session: AsyncSession, message_id: int, user_id: int
) -> Message:
    """Возвращает сообщение, если пользователь состоит в его чате."""
    message = await _load_message(session, message_id)
    if message is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Сообщение не найдено",
        )
    await _ensure_chat_member_or_404(session, chat_id=message.chat_id, user_id=user_id)
    return message


async def send_text_message(
    session: AsyncSession,
    *,
    chat_id: int,
    text: str,
    user_id: int,
    reply_to_id: int | None = None,
) -> dict:
    """Отправляет текстовое сообщение."""
    await _ensure_chat_member_or_404(session, chat_id=chat_id, user_id=user_id)
    if reply_to_id is not None:
        await _validate_reply(session, chat_id=chat_id, reply_to_id=reply_to_id)

    message = Message(
        text=text, chat_id=chat_id, user_id=user_id, reply_to_id=reply_to_id
    )
    session.add(message)
    await session.commit()

    result = await _reload_and_serialize(session, message.id, user_id)
    await notify_chat(
        session,
        chat_id=chat_id,
        payload={
            "type": "message.new",
            "chat_id": chat_id,
            "message_id": message.id,
            "sender_id": user_id,
        },
        exclude_user_id=user_id,
    )
    return result


async def send_attachment_message(
    session: AsyncSession,
    *,
    chat_id: int,
    user_id: int,
    file_name: str,
    file_url: str,
    mime_type: str | None,
    file_size: int | None,
    text: str = "",
    reply_to_id: int | None = None,
) -> dict:
    """Отправляет сообщение с файлом-вложением."""
    await _ensure_chat_member_or_404(session, chat_id=chat_id, user_id=user_id)
    if reply_to_id is not None:
        await _validate_reply(session, chat_id=chat_id, reply_to_id=reply_to_id)

    message = Message(
        text=text,
        chat_id=chat_id,
        user_id=user_id,
        reply_to_id=reply_to_id,
        file_name=file_name,
        file_url=file_url,
        mime_type=mime_type,
        file_size=file_size,
    )
    session.add(message)
    await session.commit()

    result = await _reload_and_serialize(session, message.id, user_id)
    await notify_chat(
        session,
        chat_id=chat_id,
        payload={
            "type": "message.new",
            "chat_id": chat_id,
            "message_id": message.id,
            "sender_id": user_id,
        },
        exclude_user_id=user_id,
    )
    return result


async def _validate_reply(
    session: AsyncSession, *, chat_id: int, reply_to_id: int
) -> None:
    """Проверяет, что сообщение-ответ существует в том же чате."""
    target = await session.get(Message, reply_to_id)
    if target is None or target.chat_id != chat_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя ответить на это сообщение",
        )


async def list_chat_messages(
    session: AsyncSession,
    *,
    chat_id: int,
    user_id: int,
    limit: int | None = None,
    before_id: int | None = None,
) -> list[dict]:
    """Возвращает сообщения чата и помечает входящие как прочитанные.

    Без параметров возвращается вся история (как раньше). При ``limit``/``before_id``
    отдаётся порция (до ``limit`` сообщений с id < ``before_id``) в хронологическом
    порядке — для «подгрузки более старых» на клиенте.
    """
    await _ensure_chat_member_or_404(session, chat_id=chat_id, user_id=user_id)

    # Помечаем сообщения собеседника прочитанными
    update_result = await session.execute(
        update(Message)
        .where(
            Message.chat_id == chat_id,
            Message.user_id != user_id,
            Message.is_read.is_(False),
        )
        .values(is_read=True)
    )
    await session.commit()
    marked_read = (update_result.rowcount or 0) > 0

    stmt = select(Message).where(Message.chat_id == chat_id)
    if before_id is not None:
        stmt = stmt.where(Message.id < before_id)

    if limit is not None:
        # Пагинация: берём порцию от новых к старым, затем разворачиваем.
        stmt = stmt.order_by(Message.timestamp.desc(), Message.id.desc()).limit(limit)
    else:
        stmt = stmt.order_by(Message.timestamp, Message.id)

    stmt = stmt.options(selectinload(Message.reactions))
    result = await session.execute(stmt)
    rows = list(result.scalars().all())
    if limit is not None:
        rows.reverse()
    items = [message_to_dict(message, user_id) for message in rows]
    if marked_read:
        await notify_chat(
            session,
            chat_id=chat_id,
            payload={
                "type": "chat.read",
                "chat_id": chat_id,
                "reader_id": user_id,
            },
            exclude_user_id=user_id,
        )
    return items


async def list_pinned_messages(
    session: AsyncSession, *, chat_id: int, user_id: int
) -> list[dict]:
    """Возвращает закреплённые сообщения чата."""
    await _ensure_chat_member_or_404(session, chat_id=chat_id, user_id=user_id)
    stmt = (
        select(Message)
        .where(Message.chat_id == chat_id, Message.is_pinned.is_(True))
        .options(selectinload(Message.reactions))
        .order_by(Message.timestamp, Message.id)
    )
    result = await session.execute(stmt)
    return [message_to_dict(message, user_id) for message in result.scalars().all()]


async def delete_message(
    session: AsyncSession, *, message_id: int, user_id: int
) -> None:
    """Удаляет сообщение (только автор) и его файл-вложение с диска."""
    message = await _get_member_message(session, message_id, user_id)
    if message.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Удалить можно только своё сообщение",
        )

    chat_id = message.chat_id
    file_path = _resolve_media_file(message.file_url)
    await session.delete(message)
    await session.commit()

    # Файл удаляем после коммита, best-effort (не критично, если не удалится).
    if file_path is not None:
        try:
            file_path.unlink(missing_ok=True)
        except OSError:
            pass

    await notify_chat(
        session,
        chat_id=chat_id,
        payload={
            "type": "message.changed",
            "chat_id": chat_id,
            "message_id": message_id,
            "kind": "deleted",
        },
        exclude_user_id=user_id,
    )


def _resolve_media_file(file_url: str | None) -> Path | None:
    """Возвращает путь к файлу вложения по URL (или None)."""
    if not file_url or not file_url.startswith("/media/"):
        return None
    # Не трогаем аватары и чужие пути.
    if file_url.startswith("/media/avatars/") or "/" in file_url[8:]:
        return None
    return MEDIA_DIR / file_url.removeprefix("/media/")


async def set_message_pinned(
    session: AsyncSession, *, message_id: int, user_id: int, is_pinned: bool
) -> dict:
    """Закрепляет/открепляет сообщение."""
    message = await _get_member_message(session, message_id, user_id)
    chat_id = message.chat_id
    message.is_pinned = is_pinned
    await session.commit()

    result = await _reload_and_serialize(session, message_id, user_id)
    await notify_chat(
        session,
        chat_id=chat_id,
        payload={
            "type": "message.changed",
            "chat_id": chat_id,
            "message_id": message_id,
            "kind": "pin",
        },
        exclude_user_id=user_id,
    )
    return result


async def set_reaction(
    session: AsyncSession,
    *,
    message_id: int,
    user_id: int,
    emoji: str | None,
) -> dict:
    """Устанавливает или снимает реакцию текущего пользователя."""
    message = await _get_member_message(session, message_id, user_id)
    chat_id = message.chat_id

    stmt = select(MessageReaction).where(
        MessageReaction.message_id == message_id,
        MessageReaction.user_id == user_id,
    )
    reaction_result = await session.execute(stmt)
    reaction = reaction_result.scalar_one_or_none()

    changed = False
    if not emoji:
        if reaction is not None:
            await session.delete(reaction)
            await session.commit()
            changed = True
    else:
        if reaction is None:
            session.add(
                MessageReaction(message_id=message_id, user_id=user_id, emoji=emoji)
            )
        else:
            reaction.emoji = emoji
        await session.commit()
        changed = True

    result = await _reload_and_serialize(session, message_id, user_id)
    if changed:
        await notify_chat(
            session,
            chat_id=chat_id,
            payload={
                "type": "message.changed",
                "chat_id": chat_id,
                "message_id": message_id,
                "kind": "reaction",
            },
            exclude_user_id=user_id,
        )
    return result


async def search_messages(
    session: AsyncSession,
    *,
    user_id: int,
    query: str,
    chat_id: int | None = None,
    limit: int = 50,
) -> list[dict]:
    """Ищет сообщения пользователя по тексту или имени файла (ILIKE).

    Если ``chat_id`` не задан — ищет по всем чатам пользователя. Возвращает
    до ``limit`` сообщений в хронологическом порядке (для отображения).
    """
    text_pattern = f"%{query}%"
    stmt = (
        select(Message)
        .where(
            or_(
                Message.text.ilike(text_pattern),
                Message.file_name.ilike(text_pattern),
            )
        )
        .options(selectinload(Message.reactions))
    )

    if chat_id is None:
        user_chats = select(user_chat_association_table.c.chat_id).where(
            user_chat_association_table.c.user_id == user_id
        )
        stmt = stmt.where(Message.chat_id.in_(user_chats))
    else:
        await _ensure_chat_member_or_404(session, chat_id=chat_id, user_id=user_id)
        stmt = stmt.where(Message.chat_id == chat_id)

    stmt = stmt.order_by(Message.timestamp.desc(), Message.id.desc()).limit(limit)
    result = await session.execute(stmt)
    rows = list(result.scalars().all())
    rows.reverse()
    return [message_to_dict(message, user_id) for message in rows]
