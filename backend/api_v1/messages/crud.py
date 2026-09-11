"""CRUD-операции для сообщений."""

from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api_v1.chats.crud import is_group_chat, is_user_chat_member, mark_group_chat_read
from api_v1.events.service import notify_chat
from api_v1.moderation import crud as moderation_crud
from core.models import (
    Chat,
    Message,
    MessageReaction,
    User,
    user_chat_association_table,
)
from core.timeutils import as_utc

_NOT_MEMBER_DETAIL = "Вы не являетесь участником этого чата"
_BLOCKED_DETAIL = "Нельзя отправить сообщение: пользователь недоступен"

# Размер «страницы» истории по умолчанию. Раньше запрос без параметров отдавал
# ВСЮ историю чата — с ростом переписки это становилось опасным (память/сеть).
# Теперь всегда возвращается порция (последние сообщения); за более старыми
# клиент идёт через ``before_id`` (см. list_chat_messages).
DEFAULT_MESSAGE_PAGE_SIZE = 100

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


def _user_display_name(user: User) -> str:
    """Отображаемое имя пользователя (как displayName на фронте)."""
    if user.first_name and user.last_name:
        return f"{user.first_name} {user.last_name}"
    if user.first_name:
        return user.first_name
    if user.last_name:
        return user.last_name
    return user.username


def _hide_filter(viewer_id: int):
    """Условие выборки: скрытое модерацией видно только автору.

    Скрытие ставит автоматика (3 жалобы от разных людей) или модератор. Автор
    должен видеть своё сообщение с пометкой «скрыто до проверки» — иначе он не
    поймёт, куда оно пропало, и не сможет его исправить.
    """
    return or_(
        Message.hidden_at.is_(None),
        Message.user_id == viewer_id,
    )


def _forwarded_payload(message: Message) -> dict | None:
    """Снимок пересылки («переслано от …») либо None для обычных сообщений."""
    if message.forwarded_from_id is None:
        return None
    return {
        "id": message.forwarded_from_id,
        "sender_id": message.forwarded_sender_id,
        "sender_name": message.forwarded_sender_name or "",
        "sender_avatar_url": message.forwarded_sender_avatar_url or None,
        "chat_id": message.forwarded_chat_id,
    }


def message_to_dict(message: Message, user_id: int) -> dict:
    """Преобразует сообщение (с загруженными реакциями) в словарь для API."""
    # Скрытое модерацией сообщение автор видит с пометкой «скрыто до проверки»
    # (текст отдаём, чтобы он понял, что именно скрыто), остальные не получают
    # его вовсе — фильтр на уровне выборки (см. _hide_filter).
    hidden = message.hidden_at is not None
    return {
        "id": message.id,
        "chat_id": message.chat_id,
        "user_id": message.user_id,
        "text": message.text,
        "timestamp": as_utc(message.timestamp),
        "reply_to_id": message.reply_to_id,
        "is_read": message.is_read,
        "is_pinned": message.is_pinned,
        "encrypted": message.encrypted,
        "edited_at": message.edited_at,
        "kind": message.kind,
        "call_kind": message.call_kind,
        "call_state": message.call_state,
        "call_duration": message.call_duration,
        "call_caller_id": message.call_caller_id,
        "hidden": hidden,
        "hidden_reason": message.hidden_reason if hidden else None,
        "file": _file_payload(message),
        "reactions": _reactions_payload(message.reactions, user_id),
        "forwarded_from": _forwarded_payload(message),
    }


def message_basic_to_dict(message: Message) -> dict:
    """Компактное представление сообщения (без реакций) для списка чатов.

    Скрытое модерацией сообщение не отдаёт содержимое: в превью чата вместо
    текста и файла уходит пометка (``hidden=true``), иначе скрытие обходилось бы
    в списке чатов. ``text`` остаётся строкой (схема API), поэтому здесь пустая
    строка, а не None.
    """
    hidden = message.hidden_at is not None
    return {
        "id": message.id,
        "chat_id": message.chat_id,
        "user_id": message.user_id,
        "text": "" if hidden else message.text,
        "timestamp": as_utc(message.timestamp),
        "reply_to_id": message.reply_to_id,
        "is_read": message.is_read,
        "is_pinned": message.is_pinned,
        "encrypted": message.encrypted,
        "edited_at": message.edited_at,
        "kind": message.kind,
        "call_kind": message.call_kind,
        "call_state": message.call_state,
        "call_duration": message.call_duration,
        "call_caller_id": message.call_caller_id,
        "hidden": hidden,
        "hidden_reason": message.hidden_reason if hidden else None,
        "file": None if hidden else _file_payload(message),
        "reactions": [],
        "forwarded_from": None if hidden else _forwarded_payload(message),
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
    """Перезагружает сообщение после изменений и возвращает словарь API.

    Сообщение могло уже быть загружено в identity-map этой сессии (например,
    в set_reaction мы взяли его в начале запроса). После commit с
    ``expire_on_commit=False`` его коллекция ``reactions`` осталась бы прежней
    (пустой при добавлении реакции), поэтому принудительно «протухаем» объект —
    повторный selectinload вернёт актуальное состояние из БД.
    """
    message = await _load_message(session, message_id)
    if message is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не удалось загрузить сообщение",
        )
    session.expire(message)
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


async def _ensure_not_blocked(
    session: AsyncSession, *, chat_id: int, user_id: int
) -> None:
    """Запрещает писать в личный чат при блокировке (в любую сторону).

    Блокировка — требование RuStore к приложениям с пользовательским контентом:
    заблокированный не должен иметь возможности доставлять сообщения, а
    блокирующий — получать их. Групповые чаты и «Сохранённые сообщения» не
    затрагиваются (там блокировка 1-1 неприменима).
    """
    members = (
        (
            await session.execute(
                select(user_chat_association_table.c.user_id).where(
                    user_chat_association_table.c.chat_id == chat_id
                )
            )
        )
        .scalars()
        .all()
    )
    if len(members) != 2:
        return
    peer_id = next((member for member in members if member != user_id), None)
    if peer_id is None:
        return
    if await moderation_crud.is_blocked_between(
        session, user_id=user_id, other_id=peer_id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_BLOCKED_DETAIL,
        )


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
    encrypted: bool = False,
) -> dict:
    """Отправляет текстовое сообщение (опционально — E2EE-шифротекст)."""
    await _ensure_chat_member_or_404(session, chat_id=chat_id, user_id=user_id)
    await _ensure_not_blocked(session, chat_id=chat_id, user_id=user_id)
    if reply_to_id is not None:
        await _validate_reply(session, chat_id=chat_id, reply_to_id=reply_to_id)

    # «Обычный» чат (E2EE выключен) не принимает шифротекст — пишем как есть,
    # чтобы превью/уведомления оставались читаемыми (сервер видит текст).
    chat_e2ee = await session.scalar(
        select(Chat.e2ee_enabled).where(Chat.id == chat_id)
    )
    if not chat_e2ee:
        encrypted = False

    message = Message(
        text=text,
        chat_id=chat_id,
        user_id=user_id,
        reply_to_id=reply_to_id,
        encrypted=encrypted,
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
    encrypted: bool = False,
) -> dict:
    """Отправляет сообщение с файлом-вложением.

    ``encrypted=True`` — вложение зашифровано на клиенте (на сервере только
    шифротекст), а ``text`` — зашифрованный конверт с ключом/именем файла.
    В «обычном» чате такие вложения запрещены: если положить их как есть,
    ключ и имя файла оказались бы на сервере в открытом виде.
    """
    await _ensure_chat_member_or_404(session, chat_id=chat_id, user_id=user_id)
    await _ensure_not_blocked(session, chat_id=chat_id, user_id=user_id)
    if reply_to_id is not None:
        await _validate_reply(session, chat_id=chat_id, reply_to_id=reply_to_id)

    chat_e2ee = await session.scalar(
        select(Chat.e2ee_enabled).where(Chat.id == chat_id)
    )
    if encrypted and not chat_e2ee:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Зашифрованное вложение можно отправить только в зашифрованный чат",
        )
    if not chat_e2ee:
        encrypted = False

    message = Message(
        text=text,
        chat_id=chat_id,
        user_id=user_id,
        reply_to_id=reply_to_id,
        file_name=file_name,
        file_url=file_url,
        mime_type=mime_type,
        file_size=file_size,
        encrypted=encrypted,
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
    """Возвращает порцию сообщений чата и помечает входящие как прочитанные.

    Отдаётся до ``limit`` (по умолчанию ``DEFAULT_MESSAGE_PAGE_SIZE``) самых
    свежих сообщений; при ``before_id`` — более старые, чем указанное id
    (пагинация «вверх»). Результат — в хронологическом порядке.
    """
    await _ensure_chat_member_or_404(session, chat_id=chat_id, user_id=user_id)

    # В группе нет общего флага прочтения — у каждого участника свой курсор
    # (last_read_message_id). В личном чате помечаем сообщения собеседника
    # прочитанными (галочки ✓✓ у отправителя).
    if await is_group_chat(session, chat_id):
        marked_read = await mark_group_chat_read(
            session, chat_id=chat_id, user_id=user_id
        )
    else:
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
    # Скрытое модерацией не отдаём никому, кроме автора: он видит пометку
    # «скрыто до проверки» и может поправить сообщение (см. moderation/service).
    stmt = stmt.where(_hide_filter(user_id))

    # Всегда работаем «страницами»: от новых к старым, затем разворачиваем.
    page_size = limit if limit is not None else DEFAULT_MESSAGE_PAGE_SIZE
    stmt = stmt.order_by(Message.timestamp.desc(), Message.id.desc()).limit(page_size)

    stmt = stmt.options(selectinload(Message.reactions))
    result = await session.execute(stmt)
    rows = list(result.scalars().all())
    rows.reverse()
    items = [message_to_dict(message, user_id) for message in rows]
    # «chat.read» нужен только для личных чатов (обновление галочек у отправителя).
    if marked_read and not await is_group_chat(session, chat_id):
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


async def mark_chat_read(session: AsyncSession, *, chat_id: int, user_id: int) -> bool:
    """Помечает все входящие сообщения чата прочитанными (без выгрузки истории)."""
    await _ensure_chat_member_or_404(session, chat_id=chat_id, user_id=user_id)
    if await is_group_chat(session, chat_id):
        marked_read = await mark_group_chat_read(
            session, chat_id=chat_id, user_id=user_id
        )
    else:
        result = await session.execute(
            update(Message)
            .where(
                Message.chat_id == chat_id,
                Message.user_id != user_id,
                Message.is_read.is_(False),
            )
            .values(is_read=True)
        )
        await session.commit()
        marked_read = (result.rowcount or 0) > 0
    # «chat.read» нужен только для личных чатов (обновление галочек у отправителя).
    if marked_read and not await is_group_chat(session, chat_id):
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
    return marked_read


async def list_pinned_messages(
    session: AsyncSession, *, chat_id: int, user_id: int
) -> list[dict]:
    """Возвращает закреплённые сообщения чата."""
    await _ensure_chat_member_or_404(session, chat_id=chat_id, user_id=user_id)
    stmt = (
        select(Message)
        .where(
            Message.chat_id == chat_id,
            Message.is_pinned.is_(True),
            _hide_filter(user_id),
        )
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


async def edit_message_text(
    session: AsyncSession, *, message_id: int, user_id: int, text: str
) -> dict:
    """Редактирует текст сообщения (только автор), ставит edited_at."""
    message = await _get_member_message(session, message_id, user_id)
    if message.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Редактировать можно только своё сообщение",
        )
    if message.encrypted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Зашифрованные сообщения нельзя редактировать",
        )

    message.text = text
    message.edited_at = datetime.now(timezone.utc)
    chat_id = message.chat_id
    await session.commit()

    result = await _reload_and_serialize(session, message_id, user_id)
    await notify_chat(
        session,
        chat_id=chat_id,
        payload={
            "type": "message.changed",
            "chat_id": chat_id,
            "message_id": message_id,
            "kind": "edited",
        },
        exclude_user_id=user_id,
    )
    return result


async def forward_message(
    session: AsyncSession,
    *,
    source_message_id: int,
    user_id: int,
    chat_id: int,
    reply_to_id: int | None = None,
) -> dict:
    """Пересылает сообщение (текст/вложение) в указанный чат от текущего юзера."""
    source = await _load_message(session, source_message_id)
    if source is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Сообщение не найдено",
        )
    # Отправитель должен состоять и в исходном, и в целевом чате.
    await _ensure_chat_member_or_404(session, chat_id=source.chat_id, user_id=user_id)
    await _ensure_chat_member_or_404(session, chat_id=chat_id, user_id=user_id)
    await _ensure_not_blocked(session, chat_id=chat_id, user_id=user_id)
    if reply_to_id is not None:
        await _validate_reply(session, chat_id=chat_id, reply_to_id=reply_to_id)
    # Скрытое модерацией в пересылку не попадает: иначе скрытие обходилось бы
    # одной пересылкой (копия уже никому не подчиняется).
    if source.hidden_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Сообщение скрыто до проверки модератором — пересылка недоступна",
        )
    if source.encrypted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Зашифрованные сообщения нельзя пересылать",
        )

    # Снимок автора оригинала для плашки «Переслано от …».
    source_sender = await session.get(User, source.user_id)

    forwarded = Message(
        text=source.text or "",
        chat_id=chat_id,
        user_id=user_id,
        reply_to_id=reply_to_id,
        file_name=source.file_name,
        file_url=source.file_url,
        mime_type=source.mime_type,
        file_size=source.file_size,
        forwarded_from_id=source.id,
        forwarded_sender_id=source.user_id,
        forwarded_sender_name=(
            _user_display_name(source_sender) if source_sender is not None else ""
        ),
        forwarded_sender_avatar_url=(
            source_sender.avatar_url if source_sender is not None else None
        ),
        forwarded_chat_id=source.chat_id,
    )
    session.add(forwarded)
    await session.commit()

    result = await _reload_and_serialize(session, forwarded.id, user_id)
    await notify_chat(
        session,
        chat_id=chat_id,
        payload={
            "type": "message.new",
            "chat_id": chat_id,
            "message_id": forwarded.id,
            "sender_id": user_id,
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

    # Скрытое модерацией не ищем: иначе поиск находил бы скрытый контент.
    stmt = stmt.where(_hide_filter(user_id))
    stmt = stmt.order_by(Message.timestamp.desc(), Message.id.desc()).limit(limit)
    result = await session.execute(stmt)
    rows = list(result.scalars().all())
    rows.reverse()
    return [message_to_dict(message, user_id) for message in rows]
