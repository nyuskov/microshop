"""CRUD-операции для чатов."""

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api_v1.events.service import notify_chat, notify_user
from api_v1.moderation import crud as moderation_crud
from api_v1.users.crud import display_name
from core.models import (
    Chat,
    ChatGroupKey,
    ChatMute,
    Message,
    User,
    user_chat_association_table,
)
from core.models.associations import ROLE_ADMIN, ROLE_CREATOR, ROLE_MEMBER
from core.timeutils import as_utc

#: За сколько дней статистика чата отдаёт разбивку по дням (итоги — за всё время).
STATS_DAYS = 30
#: Сколько участников показываем в «топе по сообщениям».
STATS_TOP_SENDERS = 5


async def get_chat_with_users(session: AsyncSession, chat_id: int) -> Chat | None:
    """Возвращает чат вместе с его участниками."""
    stmt = select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.users))
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def is_user_chat_member(
    session: AsyncSession, chat_id: int, user_id: int
) -> bool:
    """Проверяет, является ли пользователь участником чата."""
    stmt = select(user_chat_association_table.c.user_id).where(
        user_chat_association_table.c.chat_id == chat_id,
        user_chat_association_table.c.user_id == user_id,
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none() is not None


async def set_chat_e2ee(
    session: AsyncSession, *, chat_id: int, user_id: int, enabled: bool
) -> bool:
    """Включает/выключает сквозное шифрование (тип чата) для участника.

    Доступно в личных чатах и в групповых (там переключать может создатель или
    админ). В «Сохранённых сообщениях» шифрование не имеет смысла — ключа
    собеседника нет.
    """
    if not await is_user_chat_member(session, chat_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Чат не найден",
        )
    chat = await session.get(Chat, chat_id)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Чат не найден",
        )
    if chat.is_self:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Сквозное шифрование недоступно в «Сохранённых сообщениях»",
        )
    if chat.is_group:
        role = await get_member_role(session, chat_id=chat_id, user_id=user_id)
        if role not in (ROLE_CREATOR, ROLE_ADMIN):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Шифрование группы включает создатель или админ",
            )
    chat.e2ee_enabled = enabled
    if chat.is_group and not enabled:
        # Выключаем шифрование — обёртки ключа группы больше не нужны. Если
        # оставить их, повторное включение переиспользовало бы старый ключ,
        # известный в том числе бывшим участникам.
        await session.execute(
            delete(ChatGroupKey).where(ChatGroupKey.chat_id == chat_id)
        )
    await session.commit()
    return chat.e2ee_enabled


async def get_private_chat_id_between(
    session: AsyncSession, first_user_id: int, second_user_id: int
) -> int | None:
    """Возвращает id чата, в котором состоят ровно два указанных пользователя."""
    stmt = (
        select(user_chat_association_table.c.chat_id)
        .where(
            user_chat_association_table.c.user_id.in_([first_user_id, second_user_id])
        )
        .group_by(user_chat_association_table.c.chat_id)
        .having(
            func.count(func.distinct(user_chat_association_table.c.user_id)) == 2,
            func.count(user_chat_association_table.c.user_id) == 2,
        )
    )
    result = await session.execute(stmt)
    return result.scalars().first()


async def create_private_chat(
    session: AsyncSession, first_user: User, second_user: User
) -> Chat:
    """Создаёт приватный чат между двумя пользователями."""
    chat = Chat(name=second_user.username)
    chat.users = [first_user, second_user]
    session.add(chat)
    await session.commit()
    # Сообщаем собеседнику о новом чате (если он на связи) — иначе он увидит
    # его только при следующем опросе/синхронизации.
    await notify_user(
        second_user.id,
        {"type": "chat.new", "chat_id": chat.id, "user_id": first_user.id},
    )
    return chat


async def get_or_create_private_chat(
    session: AsyncSession, first_user_id: int, second_user_id: int
) -> Chat:
    """Возвращает существующий приватный чат или создаёт новый."""
    if first_user_id == second_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя начать переписку с самим собой",
        )

    second_user = await session.get(User, second_user_id)
    if second_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )

    chat_id = await get_private_chat_id_between(session, first_user_id, second_user_id)
    if chat_id is not None:
        chat = await get_chat_with_users(session, chat_id)
        if chat is not None:
            return chat

    first_user = await session.get(User, first_user_id)
    if first_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Пользователь не найден",
        )
    return await create_private_chat(session, first_user, second_user)


async def get_user_chats(session: AsyncSession, user_id: int) -> list[Chat]:
    """Возвращает чаты пользователя (без личных чатов с заблокированными).

    Блокировка — требование RuStore для приложений с пользовательским контентом:
    диалог с заблокированным скрывается у того, кто заблокировал (снять
    блокировку можно в разделе «Заблокированные»). Группы не затрагиваются.
    """
    subq = select(user_chat_association_table.c.chat_id).where(
        user_chat_association_table.c.user_id == user_id
    )
    stmt = (
        select(Chat)
        .where(Chat.id.in_(subq))
        .options(selectinload(Chat.users))
        .order_by(Chat.id)
    )
    result = await session.execute(stmt)
    chats = list(result.scalars().all())

    blocked_ids = await moderation_crud.get_blocked_ids(session, blocker_id=user_id)
    if not blocked_ids:
        return chats
    return [chat for chat in chats if _chat_visible(chat, user_id, blocked_ids)]


def _chat_visible(chat: Chat, user_id: int, blocked_ids: set[int]) -> bool:
    """Виден ли чат пользователю (личный чат с заблокированным — нет)."""
    if chat.is_group:
        return True
    others = [member.id for member in chat.users if member.id != user_id]
    return not any(member_id in blocked_ids for member_id in others)


async def get_or_create_self_chat(session: AsyncSession, user: User) -> Chat:
    """Возвращает (или создаёт) личный чат «Сохранённые сообщения»."""
    stmt = (
        select(Chat)
        .join(
            user_chat_association_table,
            user_chat_association_table.c.chat_id == Chat.id,
        )
        .where(
            Chat.is_self.is_(True),
            user_chat_association_table.c.user_id == user.id,
        )
        .options(selectinload(Chat.users))
    )
    chat = (await session.execute(stmt)).scalars().first()
    if chat is not None:
        return chat
    chat = Chat(name="Сохранённые сообщения", is_self=True)
    chat.users = [user]
    session.add(chat)
    await session.commit()
    return chat


async def get_last_messages(
    session: AsyncSession, chat_ids: list[int]
) -> dict[int, Message]:
    """Возвращает последнее сообщение для каждого чата."""
    if not chat_ids:
        return {}

    stmt = (
        select(Message)
        .where(Message.chat_id.in_(chat_ids))
        .order_by(Message.chat_id, Message.timestamp, Message.id)
    )
    result = await session.execute(stmt)

    last_by_chat: dict[int, Message] = {}
    for message in result.scalars().all():
        last_by_chat[message.chat_id] = message
    return last_by_chat


async def get_unread_counts(
    session: AsyncSession, chat_ids: list[int], user_id: int
) -> dict[int, int]:
    """Возвращает количество непрочитанных сообщений для каждого чата.

    В личных чатах считаем непрочитанными входящие сообщения с ``is_read=False``.
    В групповых — сообщения, пришедшие после курсора прочтения участника
    (``chat_user_association.last_read_message_id``), т.к. на общий флаг
    ``Message.is_read`` опираться нельзя (его «прочитал» кто-то другой).
    """
    if not chat_ids:
        return {}

    rows = await session.execute(
        select(Chat.id, Chat.is_group).where(Chat.id.in_(chat_ids))
    )
    chat_kinds = rows.all()
    counts: dict[int, int] = {}

    group_ids = [chat_id for chat_id, is_group in chat_kinds if is_group]
    if group_ids:
        cursor_rows = await session.execute(
            select(
                user_chat_association_table.c.chat_id,
                user_chat_association_table.c.last_read_message_id,
            ).where(
                user_chat_association_table.c.chat_id.in_(group_ids),
                user_chat_association_table.c.user_id == user_id,
            )
        )
        cursors = {
            chat_id: (last_read or 0) for chat_id, last_read in cursor_rows.all()
        }
        for chat_id in group_ids:
            stmt = (
                select(func.count())
                .select_from(Message)
                .where(
                    Message.chat_id == chat_id,
                    Message.user_id != user_id,
                    Message.id > cursors.get(chat_id, 0),
                )
            )
            count = await session.scalar(stmt)
            counts[chat_id] = count or 0

    private_ids = [chat_id for chat_id, _ in chat_kinds if chat_id not in counts]
    if private_ids:
        count_stmt = (
            select(Message.chat_id, func.count(Message.id))
            .where(
                Message.chat_id.in_(private_ids),
                Message.user_id != user_id,
                Message.is_read.is_(False),
            )
            .group_by(Message.chat_id)
        )
        result = await session.execute(count_stmt)
        for chat_id, count in result.all():
            counts[chat_id] = count or 0
    return counts


async def get_muted_chat_ids(
    session: AsyncSession, *, user_id: int, chat_ids: list[int]
) -> set[int]:
    """Возвращает id чатов из ``chat_ids``, замьюченных пользователем."""
    if not chat_ids:
        return set()
    stmt = select(ChatMute.chat_id).where(
        ChatMute.user_id == user_id,
        ChatMute.chat_id.in_(chat_ids),
    )
    result = await session.execute(stmt)
    return set(result.scalars().all())


async def _sender_names(session: AsyncSession, user_ids: list[int]) -> dict[int, str]:
    """Имена участников по id — для «топа по сообщениям»."""
    if not user_ids:
        return {}
    rows = (
        (await session.execute(select(User).where(User.id.in_(user_ids))))
        .scalars()
        .all()
    )
    return {user.id: display_name(user) for user in rows}


async def chat_stats(
    session: AsyncSession, *, chat_id: int, offset_minutes: int = 0
) -> dict:
    """Статистика переписки: сколько писали, когда, кто активнее и что за медиа.

    Скрытые модерацией сообщения не считаем — они под вопросом и в «статистике
    чата» выглядели бы как обычная активность.

    Дни считаются по поясу зрителя (`offset_minutes`, как в тихих часах):
    сервер живёт в UTC, а без сдвига вечерние сообщения попадали бы в «следующий
    день», и график врал бы на несколько часов.
    """
    # Импорт внутри функции: messages/crud уже импортирует этот модуль, и на
    # уровне модуля получился бы цикл.
    from api_v1.messages.crud import media_kind_expr

    scope = (Message.chat_id == chat_id, Message.hidden_at.is_(None))

    total = await session.scalar(
        select(func.count()).select_from(Message).where(*scope)
    )
    bounds = (
        await session.execute(
            select(func.min(Message.timestamp), func.max(Message.timestamp)).where(
                *scope
            )
        )
    ).one()

    # make_interval(years, months, weeks, days, hours, mins) — 6 аргументов.
    local_time = Message.timestamp + func.make_interval(0, 0, 0, 0, 0, offset_minutes)
    # Колонка времени сообщения — naive (без зоны), значит и порог сравниваем
    # с naive UTC: aware-значение asyncpg отвергает.
    since = (datetime.now(timezone.utc) - timedelta(days=STATS_DAYS - 1)).replace(
        tzinfo=None
    )
    # Группируем по самому выражению (а не по алиасу): в PostgreSQL `GROUP BY day`
    # для выражения с алиасом не находит колонку и запрос падает.
    day_expr = func.date(local_time)
    days = (
        await session.execute(
            select(day_expr.label("day"), func.count().label("total"))
            .where(*scope, Message.timestamp >= since)
            .group_by(day_expr)
            .order_by(day_expr)
        )
    ).all()

    media_kind = media_kind_expr()
    media_rows = (
        await session.execute(
            select(media_kind.label("kind"), func.count())
            .where(*scope, Message.file_url.isnot(None))
            .group_by(media_kind)
        )
    ).all()

    senders = (
        await session.execute(
            select(Message.user_id, func.count().label("total"))
            .where(*scope)
            .group_by(Message.user_id)
            .order_by(func.count().desc())
            .limit(STATS_TOP_SENDERS)
        )
    ).all()
    names = await _sender_names(session, [row[0] for row in senders])

    media = {"image": 0, "video": 0, "audio": 0, "file": 0}
    for kind, count in media_rows:
        media[str(kind)] = int(count)

    return {
        "messages_total": int(total or 0),
        "first_at": as_utc(bounds[0]),
        "last_at": as_utc(bounds[1]),
        "days": [{"date": day, "count": int(count)} for day, count in days],
        "media": media,
        "top_senders": [
            {
                "user_id": user_id,
                # Пустое имя — участник удалил аккаунт; клиент покажет «Участник».
                "name": names.get(user_id, ""),
                "count": int(count),
            }
            for user_id, count in senders
        ],
    }


async def set_chat_muted(
    session: AsyncSession, *, chat_id: int, user_id: int, muted: bool
) -> bool:
    """Включает/выключает mute чата для пользователя (проверяя членство).

    Возвращает итоговое состояние mute.
    """
    if not await is_user_chat_member(session, chat_id=chat_id, user_id=user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Чат не найден",
        )
    if muted:
        exists = await session.scalar(
            select(ChatMute.user_id).where(
                ChatMute.user_id == user_id,
                ChatMute.chat_id == chat_id,
            )
        )
        if exists is None:
            session.add(ChatMute(user_id=user_id, chat_id=chat_id))
            await session.commit()
    else:
        await session.execute(
            delete(ChatMute).where(
                ChatMute.user_id == user_id,
                ChatMute.chat_id == chat_id,
            )
        )
        await session.commit()
    return muted


async def leave_chat(
    session: AsyncSession, *, chat_id: int, user_id: int, for_all: bool = False
) -> None:
    """Удаляет чат у текущего пользователя.

    ``for_all=False`` — «только у меня»: убирает пользователя из чата; если
    участников не осталось, удаляет и чат, и его сообщения.

    ``for_all=True`` — «для всех»: удаляет чат целиком (участники, сообщения).

    Для групповых чатов семантика своя:
      * ``for_all=True`` — удаление группы целиком; разрешено только создателю;
      * ``for_all=False`` — «покинуть группу»; создатель не может выйти, пока в
        группе есть другие участники (ему нужно удалить группу целиком).
    """
    if not await is_user_chat_member(session, chat_id=chat_id, user_id=user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Чат не найден",
        )

    chat = await session.get(Chat, chat_id)
    if chat is not None and chat.is_self:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="«Сохранённые сообщения» нельзя удалить",
        )

    is_group = chat is not None and chat.is_group

    if for_all:
        members: list[int] = []
        if is_group:
            role = await get_member_role(session, chat_id=chat_id, user_id=user_id)
            if role != "creator":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Удалить группу может только её создатель",
                )
            # Запоминаем участников до удаления, чтобы уведомить их.
            member_rows = await session.execute(
                select(user_chat_association_table.c.user_id).where(
                    user_chat_association_table.c.chat_id == chat_id
                )
            )
            members = [
                member_id
                for member_id in member_rows.scalars().all()
                if member_id != user_id
            ]
        await session.execute(
            user_chat_association_table.delete().where(
                user_chat_association_table.c.chat_id == chat_id
            )
        )
        await session.execute(delete(Message).where(Message.chat_id == chat_id))
        await session.execute(delete(Chat).where(Chat.id == chat_id))
        await session.commit()
        # Сообщаем остальным участникам, что группы больше нет.
        for member_id in members:
            await notify_user(
                member_id,
                {
                    "type": "chat.removed",
                    "chat_id": chat_id,
                    "user_id": user_id,
                },
            )
        return

    if is_group:
        role = await get_member_role(session, chat_id=chat_id, user_id=user_id)
        remaining_total = await session.scalar(
            select(func.count())
            .select_from(user_chat_association_table)
            .where(user_chat_association_table.c.chat_id == chat_id)
        )
        # Создатель покидает группу, только когда он последний участник
        # (тогда группа удаляется). Иначе — пусть передаст роль или удалит группу.
        if role == "creator" and (remaining_total or 0) > 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Создатель не может покинуть группу с участниками. "
                    "Удалите группу целиком"
                ),
            )

    await session.execute(
        user_chat_association_table.delete().where(
            user_chat_association_table.c.chat_id == chat_id,
            user_chat_association_table.c.user_id == user_id,
        )
    )
    # Уходя из чата, снимаем и свой mute (иначе останется «висящая» запись).
    await session.execute(
        delete(ChatMute).where(
            ChatMute.chat_id == chat_id,
            ChatMute.user_id == user_id,
        )
    )

    remaining = await session.scalar(
        select(func.count())
        .select_from(user_chat_association_table)
        .where(user_chat_association_table.c.chat_id == chat_id)
    )
    if (remaining or 0) == 0:
        await session.execute(delete(Message).where(Message.chat_id == chat_id))
        await session.execute(delete(Chat).where(Chat.id == chat_id))
        await session.commit()
        return

    await session.commit()

    # Участники, оставшиеся в группе, должны увидеть обновлённый состав.
    if is_group:
        await notify_chat(
            session,
            chat_id=chat_id,
            payload={
                "type": "chat.updated",
                "chat_id": chat_id,
                "user_id": user_id,
                "action": "left",
            },
            exclude_user_id=user_id,
        )


# ======================================================================
# Групповые чаты
# ======================================================================


async def get_member_role(
    session: AsyncSession, *, chat_id: int, user_id: int
) -> str | None:
    """Возвращает роль участника в чате (None — не участник)."""
    stmt = select(user_chat_association_table.c.role).where(
        user_chat_association_table.c.chat_id == chat_id,
        user_chat_association_table.c.user_id == user_id,
    )
    return await session.scalar(stmt)


async def get_my_roles(
    session: AsyncSession, chat_ids: list[int], user_id: int
) -> dict[int, str]:
    """Возвращает роль текущего пользователя для каждого из ``chat_ids``."""
    if not chat_ids:
        return {}
    stmt = select(
        user_chat_association_table.c.chat_id,
        user_chat_association_table.c.role,
    ).where(
        user_chat_association_table.c.chat_id.in_(chat_ids),
        user_chat_association_table.c.user_id == user_id,
    )
    result = await session.execute(stmt)
    return {chat_id: role for chat_id, role in result.all()}


async def get_chat_members(
    session: AsyncSession, chat_id: int
) -> list[tuple[User, str]]:
    """Возвращает участников чата вместе с их ролями (в порядке вступления)."""
    stmt = (
        select(User, user_chat_association_table.c.role)
        .join(
            user_chat_association_table,
            user_chat_association_table.c.user_id == User.id,
        )
        .where(user_chat_association_table.c.chat_id == chat_id)
        .order_by(user_chat_association_table.c.joined_at)
    )
    result = await session.execute(stmt)
    return [(user, role) for user, role in result.all()]


async def create_group_chat(
    session: AsyncSession,
    *,
    user_id: int,
    name: str,
    user_ids: list[int],
    description: str | None = None,
) -> Chat:
    """Создаёт групповой чат: создатель + перечисленные участники."""
    all_ids = list(dict.fromkeys([user_id, *user_ids]))

    users_result = await session.execute(select(User).where(User.id.in_(all_ids)))
    found = {user.id: user for user in users_result.scalars().all()}
    if user_id not in found or len(found) != len(all_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Один из пользователей не найден",
        )

    chat = Chat(
        name=name.strip() or "Группа",
        description=(description or "").strip() or None,
        is_group=True,
        creator_id=user_id,
    )
    session.add(chat)
    await session.flush()

    rows = [
        {
            "chat_id": chat.id,
            "user_id": uid,
            "role": ROLE_CREATOR if uid == user_id else ROLE_MEMBER,
        }
        for uid in all_ids
    ]
    await session.execute(user_chat_association_table.insert(), rows)
    await session.commit()

    reloaded = await get_chat_with_users(session, chat.id)
    if reloaded is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не удалось создать группу",
        )
    return reloaded


async def add_group_members(
    session: AsyncSession,
    *,
    chat_id: int,
    user_ids: list[int],
) -> list[int]:
    """Добавляет участников в группу, возвращает id добавленных пользователей.

    Уже состоящих в группе пропускает. Для новых участников курсор прочтения
    сразу ставится на последнее сообщение — история до вступления не считается
    непрочитанной.
    """
    existing = await session.execute(
        select(user_chat_association_table.c.user_id).where(
            user_chat_association_table.c.chat_id == chat_id
        )
    )
    existing_ids = set(existing.scalars().all())

    to_add = [uid for uid in dict.fromkeys(user_ids) if uid not in existing_ids]
    if not to_add:
        return []

    users_result = await session.execute(select(User.id).where(User.id.in_(to_add)))
    found = set(users_result.scalars().all())
    to_add = [uid for uid in to_add if uid in found]
    if not to_add:
        return []

    max_message_id = await session.scalar(
        select(func.max(Message.id)).where(Message.chat_id == chat_id)
    )
    rows = [
        {
            "chat_id": chat_id,
            "user_id": uid,
            "role": ROLE_MEMBER,
            "last_read_message_id": max_message_id,
        }
        for uid in to_add
    ]
    await session.execute(user_chat_association_table.insert(), rows)
    await session.commit()
    return to_add


async def kick_group_member(
    session: AsyncSession,
    *,
    chat_id: int,
    actor_id: int,
    user_id: int,
) -> None:
    """Исключает участника из группы (создатель/админ)."""
    if user_id == actor_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Чтобы выйти из группы, нажмите «Покинуть группу»",
        )

    actor_role = await get_member_role(session, chat_id=chat_id, user_id=actor_id)
    if actor_role not in (ROLE_CREATOR, ROLE_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав для исключения участника",
        )

    target_role = await get_member_role(session, chat_id=chat_id, user_id=user_id)
    if target_role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не состоит в группе",
        )
    # Админ может исключать только обычных участников; создателя — никто.
    if target_role == ROLE_CREATOR:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя исключить создателя группы",
        )
    if actor_role == ROLE_ADMIN and target_role == ROLE_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Админ не может исключать другого админа",
        )

    await session.execute(
        user_chat_association_table.delete().where(
            user_chat_association_table.c.chat_id == chat_id,
            user_chat_association_table.c.user_id == user_id,
        )
    )
    await session.execute(
        delete(ChatMute).where(
            ChatMute.chat_id == chat_id,
            ChatMute.user_id == user_id,
        )
    )
    await session.commit()

    # Исключённому — убрать чат из его списка; остальным — обновить состав.
    await notify_user(
        user_id,
        {"type": "chat.removed", "chat_id": chat_id, "user_id": actor_id},
    )
    await notify_chat(
        session,
        chat_id=chat_id,
        payload={
            "type": "chat.updated",
            "chat_id": chat_id,
            "user_id": user_id,
            "action": "removed",
        },
        exclude_user_id=user_id,
    )


async def set_group_member_role(
    session: AsyncSession,
    *,
    chat_id: int,
    actor_id: int,
    user_id: int,
    role: str,
) -> None:
    """Назначает/снимает админа группы (только создатель)."""
    if user_id == actor_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя изменить собственную роль",
        )

    actor_role = await get_member_role(session, chat_id=chat_id, user_id=actor_id)
    if actor_role != ROLE_CREATOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Назначать админов может только создатель группы",
        )

    target_role = await get_member_role(session, chat_id=chat_id, user_id=user_id)
    if target_role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не состоит в группе",
        )
    if role not in (ROLE_ADMIN, ROLE_MEMBER):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Недопустимая роль",
        )

    await session.execute(
        user_chat_association_table.update()
        .where(
            user_chat_association_table.c.chat_id == chat_id,
            user_chat_association_table.c.user_id == user_id,
        )
        .values(role=role)
    )
    await session.commit()

    await notify_chat(
        session,
        chat_id=chat_id,
        payload={
            "type": "chat.updated",
            "chat_id": chat_id,
            "user_id": user_id,
            "action": "role",
            "role": role,
        },
    )


async def update_group_info(
    session: AsyncSession,
    *,
    chat_id: int,
    actor_id: int,
    name: str | None = None,
    description: str | None = None,
) -> Chat:
    """Обновляет название/описание группы (создатель/админ)."""
    actor_role = await get_member_role(session, chat_id=chat_id, user_id=actor_id)
    if actor_role not in (ROLE_CREATOR, ROLE_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Изменять группу могут только создатель и админы",
        )

    chat = await session.get(Chat, chat_id)
    if chat is None or not chat.is_group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Группа не найдена",
        )
    if name is not None:
        stripped = name.strip()
        if not stripped:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Название группы не может быть пустым",
            )
        chat.name = stripped
    if description is not None:
        chat.description = description.strip() or None
    await session.commit()

    await notify_chat(
        session,
        chat_id=chat_id,
        payload={
            "type": "chat.updated",
            "chat_id": chat_id,
            "action": "info",
        },
        exclude_user_id=actor_id,
    )
    reloaded = await get_chat_with_users(session, chat_id)
    if reloaded is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не удалось обновить группу",
        )
    return reloaded


async def is_group_chat(session: AsyncSession, chat_id: int) -> bool | None:
    """Является ли чат групповым (None — чат не найден)."""
    return await session.scalar(select(Chat.is_group).where(Chat.id == chat_id))


async def mark_group_chat_read(
    session: AsyncSession, *, chat_id: int, user_id: int
) -> bool:
    """Передвигает курсор прочтения участника на последнее сообщение группы.

    Возвращает True, если курсор реально сдвинулся (появились прочитанные).
    """
    newest_id = await session.scalar(
        select(func.max(Message.id)).where(Message.chat_id == chat_id)
    )
    if newest_id is None:
        return False

    current = await session.scalar(
        select(user_chat_association_table.c.last_read_message_id).where(
            user_chat_association_table.c.chat_id == chat_id,
            user_chat_association_table.c.user_id == user_id,
        )
    )
    if (current or 0) >= newest_id:
        return False

    await session.execute(
        user_chat_association_table.update()
        .where(
            user_chat_association_table.c.chat_id == chat_id,
            user_chat_association_table.c.user_id == user_id,
        )
        .values(last_read_message_id=newest_id)
    )
    await session.commit()
    return True
