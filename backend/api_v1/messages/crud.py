"""CRUD-операции для сообщений."""

from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.sql.elements import ColumnElement

from api_v1.channels.crud import ensure_can_post
from api_v1.chats.crud import (
    ensure_can_write,
    is_group_chat,
    is_user_chat_member,
    mark_group_chat_read,
)
from api_v1.events.service import notify_chat, notify_chat_read_elsewhere
from api_v1.moderation import crud as moderation_crud
from core.models import (
    Chat,
    Message,
    MessageReaction,
    Story,
    User,
    user_chat_association_table,
)
from core.timeutils import as_utc

_NOT_MEMBER_DETAIL = "Вы не являетесь участником этого чата"
_BLOCKED_DETAIL = "Нельзя отправить сообщение: пользователь недоступен"

# Сколько сообщений максимум перебирает поиск за один запрос.
#
# Текст сообщений зашифрован «в покое» (core/at_rest), поэтому поиск идёт в
# приложении: без предела один запрос вычитывал бы всю историю пользователя.
# Предел с запасом покрывает реальные чаты, а когда сообщений больше, поиск так
# же, как раньше, отдаёт самые свежие совпадения.
SEARCH_SCAN_LIMIT = 20_000

# Размер «страницы» истории по умолчанию. Раньше запрос без параметров отдавал
# ВСЮ историю чата — с ростом переписки это становилось опасным (память/сеть).
# Теперь всегда возвращается порция (последние сообщения); за более старыми
# клиент идёт через ``before_id`` (см. list_chat_messages).
DEFAULT_MESSAGE_PAGE_SIZE = 100

# Размер «страницы» галереи медиа (вложения чата). Меньше истории: галерея
# рисуется сеткой по 3 в ряд, и первые экраны должны появляться сразу.
DEFAULT_MEDIA_PAGE_SIZE = 60

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


#: Типы вложений для галереи и расширения, по которым их узнаём, если клиент не
#: прислал mime. Порядок важен: сначала mime, потом расширение.
MEDIA_KINDS = ("image", "video", "audio")
MEDIA_EXTENSIONS = {
    "image": ("jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"),
    # webm здесь — видеозапись: голосовые приходят с mime audio/webm и
    # определяются по mime (см. ниже).
    "video": ("mp4", "mov", "mkv", "m4v", "avi", "webm"),
    "audio": ("mp3", "m4a", "ogg", "wav", "aac", "opus"),
}


def _media_kind_of(message: Message) -> str:
    """Тип вложения для галереи: image / video / audio / file.

    Сначала смотрим mime (его присылает клиент), затем расширение файла — оно
    проверено белым списком при загрузке. Правило одно и то же с SQL-выражением
    ``_media_kind_expr``, иначе фильтр вкладки и подпись элемента разошлись бы.
    """
    mime = (message.mime_type or "").lower()
    for kind in MEDIA_KINDS:
        if mime.startswith(f"{kind}/"):
            return kind
    name = (message.file_name or "").lower()
    ext = name.rsplit(".", 1)[-1] if "." in name else ""
    for kind in MEDIA_KINDS:
        if ext in MEDIA_EXTENSIONS[kind]:
            return kind
    return "file"


def media_kind_expr():
    """SQL-выражение типа вложения (то же правило, что в ``_media_kind_of``)."""
    mime = func.coalesce(func.lower(Message.mime_type), "")
    ext = func.coalesce(func.lower(Message.file_name), "")
    extension_cases = [
        (
            or_(*[ext.like(f"%.{suffix}") for suffix in MEDIA_EXTENSIONS[kind]]),
            kind,
        )
        for kind in MEDIA_KINDS
    ]
    return case(
        *[(mime.like(f"{kind}/%"), kind) for kind in MEDIA_KINDS],
        *extension_cases,
        else_="file",
    )


def _media_payload(message: Message) -> dict:
    """Элемент галереи «Медиа»: без реакций и текста — только вложение."""
    return {
        "id": message.id,
        "timestamp": as_utc(message.timestamp),
        "url": message.file_url,
        "name": message.file_name or "Файл",
        "mime": message.mime_type,
        "size": message.file_size,
        "kind": _media_kind_of(message),
    }


async def _chat_is_e2ee(session: AsyncSession, chat_id: int) -> bool:
    """Включено ли в чате сквозное шифрование."""
    result = await session.execute(select(Chat.e2ee_enabled).where(Chat.id == chat_id))
    return bool(result.scalar_one_or_none())


def _reactions_payload(reactions: list[MessageReaction], user_id: int) -> list[dict]:
    """Агрегирует реакции по эмодзи (со списком id поставивших)."""
    aggregated: dict[str, dict] = {}
    for reaction in reactions:
        item = aggregated.setdefault(
            reaction.emoji,
            {
                "emoji": reaction.emoji,
                "count": 0,
                "reacted_by_me": False,
                "user_ids": [],
            },
        )
        item["count"] += 1
        item["user_ids"].append(reaction.user_id)
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


def _story_reply_payload(message: Message) -> dict | None:
    """Плашка «ответ на историю» либо None для обычных сообщений.

    Медиа берём из снимка в самом сообщении: истории живут сутки, а сообщение
    остаётся — и плашка должна остаться осмысленной (как снимок отправителя у
    пересланных). ``id`` может обнулиться (история удалена) — плашка всё равно
    показывается по снимку.
    """
    if message.reply_to_story_id is None and not message.reply_to_story_media_url:
        return None
    return {
        "id": message.reply_to_story_id,
        "media_url": message.reply_to_story_media_url,
        "mime_type": message.reply_to_story_mime_type,
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
        "view_once": message.view_once,
        # Вложение уже сгорело: клиент покажет плашку «Просмотрено» и не будет
        # запрашивать файл (сервер ответит «истёк»).
        "view_once_opened": message.view_once_opened_at is not None,
        "reactions": _reactions_payload(message.reactions, user_id),
        "forwarded_from": _forwarded_payload(message),
        "reply_to_story": _story_reply_payload(message),
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
        "reply_to_story": None if hidden else _story_reply_payload(message),
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
    reply_to_story_id: int | None = None,
    encrypted: bool = False,
) -> dict:
    """Отправляет текстовое сообщение (опционально — E2EE-шифротекст).

    ``reply_to_story_id`` — ответ на историю: сообщение уходит автору истории,
    а рядом со снимком медиа остаётся плашка «Ответ на историю» (снимок
    переживёт удаление истории).
    """
    await _ensure_chat_member_or_404(session, chat_id=chat_id, user_id=user_id)
    # В канале писать в ленту могут только владелец и админы.
    await ensure_can_post(session, chat_id, user_id)
    # Анти-флуд: мут, бан и медленный режим группы.
    await ensure_can_write(session, chat_id=chat_id, user_id=user_id)
    await _ensure_not_blocked(session, chat_id=chat_id, user_id=user_id)
    if reply_to_id is not None:
        await _validate_reply(session, chat_id=chat_id, reply_to_id=reply_to_id)

    story: Story | None = None
    if reply_to_story_id is not None:
        story = await _validate_story_reply(
            session, chat_id=chat_id, story_id=reply_to_story_id, user_id=user_id
        )

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
        reply_to_story_id=story.id if story is not None else None,
        reply_to_story_media_url=story.media_url if story is not None else None,
        reply_to_story_mime_type=story.mime_type if story is not None else None,
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
    kind: str = "text",
    view_once: bool = False,
) -> dict:
    """Отправляет сообщение с файлом-вложением.

    ``encrypted=True`` — вложение зашифровано на клиенте (на сервере только
    шифротекст), а ``text`` — зашифрованный конверт с ключом/именем файла.
    В «обычном» чате такие вложения запрещены: если положить их как есть,
    ключ и имя файла оказались бы на сервере в открытом виде.

    ``kind='sticker'`` — картинка-стикер: сообщение рисуется без пузыря
    (см. `api_v1/stickers` — панель стикеров шлёт так свои картинки).

    ``view_once=True`` — вложение сгорает после просмотра: сервер отдаст файл
    один раз (см. ``api_v1/media/views.py``), дальше в ленте останется плашка.
    """
    await _ensure_chat_member_or_404(session, chat_id=chat_id, user_id=user_id)
    # Анти-флуд: мут, бан и медленный режим группы (иначе ограничение текста
    # обходилось бы «отправить картинкой»).
    await ensure_can_write(session, chat_id=chat_id, user_id=user_id)
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
        kind=kind,
        file_name=file_name,
        file_url=file_url,
        mime_type=mime_type,
        file_size=file_size,
        encrypted=encrypted,
        view_once=view_once,
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


async def _validate_story_reply(
    session: AsyncSession, *, chat_id: int, story_id: int, user_id: int
) -> Story:
    """Проверяет, что ответ на историю адресован её автору в этом чате.

    Три правила: история существует и ещё не истекла (отвечать в пустоту
    бессмысленно), отвечает не её автор (себе не отвечают) и автор истории —
    участник именно этого чата (иначе пометка вела бы к чужому человеку).

    Истёкшую историю отклоняем, хотя в ленте её уже нет: клиент мог держать
    просмотрщик открытым до срока.
    """
    story = await session.get(Story, story_id)
    if story is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="История не найдена",
        )
    if story.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="История больше не доступна",
        )
    if story.user_id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Это ваша история",
        )
    if not await is_user_chat_member(session, chat_id=chat_id, user_id=story.user_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ответ на историю отправляется автору в личный чат",
        )
    return story


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
    # Свои другие устройства тоже должны погасить значок непрочитанного.
    if marked_read:
        await notify_chat_read_elsewhere(user_id, chat_id)
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
    # Свои другие устройства тоже должны погасить значок непрочитанного.
    if marked_read:
        await notify_chat_read_elsewhere(user_id, chat_id)
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


async def list_chat_media(
    session: AsyncSession,
    *,
    chat_id: int,
    user_id: int,
    kind: str | None = None,
    limit: int | None = None,
    before_id: int | None = None,
) -> list[dict]:
    """Вложения чата для галереи «Медиа» (без выгрузки всей истории).

    Лента отдаёт сообщения страницами, поэтому галерея из загруженной истории
    показывала только последние ~100 сообщений. Здесь сервер сам выбирает
    сообщения с вложением: ``kind`` (image/video/audio/file) фильтрует по типу,
    ``before_id`` — пагинация «в старые».

    Зашифрованные чаты пропускаем: содержимое вложений зашифровано ключом чата,
    сервер не может ни показать картинку, ни определить её тип, а клиенту для
    расшифровки нужны сами сообщения — там галерея строится из загруженной
    истории.

    Одноразовые вложения тоже не показываем: галерея отдаёт ссылки списком, а
    каждый показ такой ссылки сжигает вложение (см. ``api_v1/media/views.py``) —
    сетка превью выпила бы все «сгораемые» картинки чата разом.
    """
    await _ensure_chat_member_or_404(session, chat_id=chat_id, user_id=user_id)
    if await _chat_is_e2ee(session, chat_id):
        return []

    stmt = select(Message).where(
        Message.chat_id == chat_id,
        Message.file_name.is_not(None),
        Message.file_url.is_not(None),
        Message.view_once.is_(False),
        _hide_filter(user_id),
    )
    if before_id is not None:
        stmt = stmt.where(Message.id < before_id)
    if kind is not None:
        stmt = stmt.where(media_kind_expr() == kind)

    page_size = limit if limit is not None else DEFAULT_MEDIA_PAGE_SIZE
    stmt = stmt.order_by(Message.id.desc()).limit(page_size)
    result = await session.execute(stmt)
    # Отдаём от новых к старым (как лента галереи в мессенджерах).
    return [_media_payload(message) for message in result.scalars().all()]


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
    # Анти-флуд целевой группы: пересылка — такое же сообщение.
    await ensure_can_write(session, chat_id=chat_id, user_id=user_id)
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
    # «Сгорающие» вложения не пересылаем: иначе одноразовость обходится одной
    # пересылкой — копия уехала бы в другой чат и осталась там навсегда.
    if source.view_once:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Одноразовое вложение переслать нельзя",
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
    """Ищет сообщения пользователя по тексту или имени файла.

    Текст сообщений хранится зашифрованным (`core.at_rest`), а по шифротексту
    SQL-ом не поискать — LIKE увидел бы base64. Поэтому поведение прежнее
    (подстрока без учёта регистра, все чаты пользователя или один), но текст
    фильтруется в приложении: страницами идём по истории от новых к старым,
    расшифровываем (это делает тип колонки) и сравниваем.

    Имя файла не шифруется (метаданные), поэтому совпадения по нему ищет
    SQL — так поиск по вложению не зависит от перебора истории.

    Ограничение — `SEARCH_SCAN_LIMIT`: просматриваем не больше сообщений за
    запрос, чтобы поиск не превращался в вычитку всей базы. Если совпадений
    больше `limit`, возвращаем самые свежие: так же, как раньше.
    """
    needle = query.strip().casefold()
    if not needle:
        return []

    if chat_id is None:
        chat_ids = select(user_chat_association_table.c.chat_id).where(
            user_chat_association_table.c.user_id == user_id
        )
        scope_cond: ColumnElement[bool] = Message.chat_id.in_(chat_ids)
    else:
        await _ensure_chat_member_or_404(session, chat_id=chat_id, user_id=user_id)
        scope_cond = Message.chat_id == chat_id

    # Скрытое модерацией не ищем: иначе поиск находил бы скрытый контент.
    scope: ColumnElement[bool] = and_(scope_cond, _hide_filter(user_id))

    found: dict[int, Message] = {}
    for message in await _file_name_matches(session, scope, query, limit):
        found[message.id] = message

    for message in await _text_matches(session, scope, needle, limit):
        found[message.id] = message
        if len(found) >= limit:
            break

    rows = sorted(found.values(), key=lambda item: (item.timestamp, item.id))
    return [message_to_dict(message, user_id) for message in rows]


async def _file_name_matches(
    session: AsyncSession, scope, query: str, limit: int
) -> list[Message]:
    """Совпадения по имени вложения (не шифруется — ищем прямо в SQL)."""
    stmt = (
        select(Message)
        .where(and_(scope, Message.file_name.ilike(f"%{query}%")))
        .options(selectinload(Message.reactions))
        .order_by(Message.timestamp.desc(), Message.id.desc())
        .limit(limit)
    )
    return list((await session.execute(stmt)).scalars().all())


async def _text_matches(
    session: AsyncSession, scope, needle: str, limit: int
) -> list[Message]:
    """Совпадения по тексту: расшифровываем историю страницами.

    Keyset-пагинация по `id` (он растёт вместе со временем) вместо OFFSET: так
    выборка не тормозит на больших чатах и не «плывёт» при новых сообщениях.
    """
    matches: list[Message] = []
    scanned = 0
    before_id: int | None = None
    page = 500
    while scanned < SEARCH_SCAN_LIMIT and len(matches) < limit:
        stmt = (
            select(Message)
            .where(and_(scope, Message.text.isnot(None)))
            .options(selectinload(Message.reactions))
            .order_by(Message.id.desc())
            .limit(page)
        )
        if before_id is not None:
            stmt = stmt.where(Message.id < before_id)
        rows = list((await session.execute(stmt)).scalars().all())
        if not rows:
            break
        for message in rows:
            scanned += 1
            # Расшифровка уже сделана типом колонки (`EncryptedText`).
            if needle in (message.text or "").casefold():
                matches.append(message)
                if len(matches) >= limit:
                    break
        before_id = rows[-1].id
        if len(rows) < page:
            break
    # Возвращаем в хронологическом порядке (старые → новые), как раньше.
    return sorted(matches, key=lambda item: (item.timestamp, item.id))
