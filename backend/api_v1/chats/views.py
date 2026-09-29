from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_user, touch_last_seen
from api_v1.chats import crud
from api_v1.chats.schemas import Chat as ChatSchema
from api_v1.chats.schemas import (
    ChatBanSchema,
    ChatDetail,
    ChatE2eeUpdate,
    ChatMemberSchema,
    ChatStats,
    ChatUserSchema,
    GroupBanCreate,
    GroupCreate,
    GroupMembersAdd,
    GroupMuteUpdate,
    GroupRoleUpdate,
    GroupSlowModeUpdate,
    GroupUpdate,
    PrivateChatCreate,
)
from api_v1.events.service import notify_chat, notify_user
from api_v1.messages.crud import message_basic_to_dict
from core.avatar_store import remove_avatar_files, store_avatar
from core.config import settings
from core.i18n import t
from core.models import Chat, Message, User, db_helper
from core.presence import scrub_last_seen
from core.rate_limit import enforce_limit
from core.upload_guard import validate_image_upload

router = APIRouter(
    prefix="/chats",
    tags=["Chats"],
)

# Аватары групповых чатов храним в том же каталоге, что и аватары пользователей
# (его раздаёт StaticFiles на /media). Лимит — как у пользовательских аватаров.
MAX_AVATAR_SIZE = settings.max_avatar_size_bytes
MAX_AVATAR_MB = MAX_AVATAR_SIZE // (1024 * 1024)
ALLOWED_AVATAR_EXTS = {"png", "jpg", "jpeg", "gif", "webp"}


def _remove_chat_avatar_files(chat: Chat) -> None:
    """Удаляет файлы аватара группы и его миниатюры (best-effort)."""
    remove_avatar_files(chat.avatar_url, chat.avatar_thumb_url)


def _chat_user_payload(user: User) -> dict:
    """Участник для ответа API: присутствие скрываем, если человек его скрыл.

    Отдаём словарь, а не объект схемы: `last_seen` на самой модели подменять
    нельзя — SQLAlchemy счёл бы поле изменённым и записал NULL в БД.
    """
    payload = ChatUserSchema.model_validate(user).model_dump()
    return scrub_last_seen(payload, user)


def _serialize_chat(
    chat: Chat,
    last_messages: dict[int, Message],
    unread_counts: dict[int, int],
    muted_ids: set[int],
    my_role: str = "member",
) -> dict:
    """Преобразует чат в словарь для ответа API."""
    last = last_messages.get(chat.id)
    return {
        "id": chat.id,
        "name": chat.name,
        "users": [_chat_user_payload(u) for u in chat.users],
        "last_message": (message_basic_to_dict(last) if last is not None else None),
        "unread_count": unread_counts.get(chat.id, 0),
        "muted": chat.id in muted_ids,
        "e2ee_enabled": chat.e2ee_enabled,
        "is_self": chat.is_self,
        "is_group": chat.is_group,
        "slow_mode_seconds": chat.slow_mode_seconds,
        "is_channel": chat.is_channel,
        "channel_username": chat.channel_username,
        "is_public": chat.is_public,
        "avatar_url": chat.avatar_url,
        "avatar_thumb_url": chat.avatar_thumb_url,
        "description": chat.description,
        "member_count": len(chat.users) if chat.is_group else 0,
        "my_role": my_role,
        "creator_id": chat.creator_id,
    }


async def _serialize_chat_full(session: AsyncSession, chat: Chat, user_id: int) -> dict:
    """Сериализует один чат с учётом непрочитанных/mute/роли текущего юзера."""
    last_messages = await crud.get_last_messages(
        session=session, chat_ids=[chat.id], viewer_id=user_id
    )
    unread_counts = await crud.get_unread_counts(
        session=session, chat_ids=[chat.id], user_id=user_id
    )
    muted_ids = await crud.get_muted_chat_ids(
        session=session, user_id=user_id, chat_ids=[chat.id]
    )
    role = await crud.get_member_role(session=session, chat_id=chat.id, user_id=user_id)
    return _serialize_chat(
        chat,
        last_messages,
        unread_counts,
        muted_ids,
        my_role=role or "member",
    )


async def _ensure_group(chat: Chat | None) -> Chat:
    """Возвращает чат, если это группа (иначе 404)."""
    if chat is None or not chat.is_group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=t("Группа не найдена"),
        )
    return chat


# «Самое старое время» для чатов без сообщений. С UTC: время сообщения приходит
# из API уже с явным смещением (core/timeutils.as_utc), и сравнение с наивной
# датой упало бы с TypeError.
_MIN_TIME = datetime.min.replace(tzinfo=timezone.utc)


def _chat_sort_key(item: dict):
    """Ключ сортировки: чаты с сообщениями сначала, новые — выше.

    Первый элемент ключа — признак «есть сообщения», и у чатов С сообщениями он
    должен быть БОЛЬШЕ: список сортируется с ``reverse=True``. Раньше признак был
    перепутан (``0`` у чатов с сообщениями), и пустые группы оказывались наверху
    списка — владелец видел «чаты с новыми стоят на месте»: свежее сообщение
    поднимало чат только внутри нижней части, а верх занимали группы без
    сообщений.
    """
    last = item.get("last_message")
    if last is None:
        # Время без сообщений — «самое старое». Сравнивать наивную дату с
        # приходящей из API (теперь всегда с UTC) нельзя — TypeError.
        return (0, _MIN_TIME)
    return (1, last["timestamp"])


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
    last_messages = await crud.get_last_messages(
        session=session, chat_ids=chat_ids, viewer_id=user.id
    )
    unread_counts = await crud.get_unread_counts(
        session=session, chat_ids=chat_ids, user_id=user.id
    )
    muted_ids = await crud.get_muted_chat_ids(
        session=session, user_id=user.id, chat_ids=chat_ids
    )
    my_roles = await crud.get_my_roles(
        session=session, chat_ids=chat_ids, user_id=user.id
    )
    items = [
        _serialize_chat(
            chat,
            last_messages,
            unread_counts,
            muted_ids,
            my_role=my_roles.get(chat.id, "member"),
        )
        for chat in chats
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
    return await _serialize_chat_full(session, chat, user.id)


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
    """Удаляет чат: только у себя (по умолчанию) либо для всех участников.

    Для групп ``for_all=True`` — удаление группы целиком (только создатель);
    ``for_all=False`` — «покинуть группу» для участника.
    """
    await crud.leave_chat(
        session=session, chat_id=chat_id, user_id=user.id, for_all=for_all
    )
    return None


@router.post("/groups/", response_model=ChatSchema)
async def create_group_chat(
    payload: GroupCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Создаёт групповой чат: текущий пользователь — создатель."""
    await enforce_limit(
        scope="chats:create_group",
        value=str(user.id),
        limit=settings.group_create_limit_per_hour,
        window_seconds=3600,
        detail=t("Слишком много групп. Попробуйте позже."),
    )
    chat = await crud.create_group_chat(
        session=session,
        user_id=user.id,
        name=payload.name,
        user_ids=payload.user_ids,
        description=payload.description,
    )
    # Приглашённым сообщаем о новом чате, чтобы он появился у них в списке.
    for uid in dict.fromkeys(payload.user_ids):
        if uid != user.id:
            await notify_user(
                uid,
                {"type": "chat.new", "chat_id": chat.id, "user_id": user.id},
            )
    return await _serialize_chat_full(session, chat, user.id)


@router.get("/{chat_id}/", response_model=ChatDetail)
async def get_chat_detail(
    chat_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Возвращает карточку чата с участниками и их ролями (для группы)."""
    chat = await crud.get_chat_with_users(session=session, chat_id=chat_id)
    if chat is None or not await crud.is_user_chat_member(
        session, chat_id=chat_id, user_id=user.id
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=t("Чат не найден"),
        )
    my_role = await crud.get_member_role(
        session=session, chat_id=chat_id, user_id=user.id
    )
    base = _serialize_chat(chat, {}, {}, set(), my_role=my_role or "member")
    return ChatDetail(**await _with_members(session, chat, base))


async def _with_members(session: AsyncSession, chat: Chat, base: dict) -> dict:
    """Дополняет карточку чата участниками: роль и мут каждого.

    Общий код для чтения карточки и для действий, которые её меняют (мут, бан):
    клиент получает в ответ ту же карточку и обновляет список участников без
    отдельного запроса.
    """
    if not chat.is_group:
        return {**base, "members": []}
    rows = await crud.get_chat_members(session=session, chat_id=chat.id)
    # Создатель — всегда первым, затем админы и участники.
    rank = {"creator": 0, "admin": 1, "member": 2}
    rows.sort(key=lambda item: (rank.get(item[1], 3), item[0].id))
    members: list[ChatMemberSchema] = []
    for member_user, role, muted_until in rows:
        payload = _chat_user_payload(member_user)
        members.append(ChatMemberSchema(**payload, role=role, muted_until=muted_until))
    return {**base, "members": members}


async def _serialize_group_detail(
    session: AsyncSession, chat: Chat, user_id: int
) -> ChatDetail:
    """Карточка группы с участниками, их ролями и мутами."""
    base = await _serialize_chat_full(session, chat, user_id)
    return ChatDetail(**await _with_members(session, chat, base))


@router.patch("/{chat_id}/", response_model=ChatSchema)
async def update_group_info(
    chat_id: int,
    payload: GroupUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Меняет название/описание группы (создатель/админ)."""
    chat = await crud.update_group_info(
        session=session,
        chat_id=chat_id,
        actor_id=user.id,
        name=payload.name,
        description=payload.description,
    )
    return await _serialize_chat_full(session, chat, user.id)


@router.get("/{chat_id}/stats/", response_model=ChatStats)
async def get_chat_stats(
    chat_id: int,
    offset_minutes: int = Query(default=0, ge=-12 * 60, le=14 * 60),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> ChatStats:
    """Статистика переписки: итоги, активность по дням, топ участников, медиа.

    Доступна только участникам чата: это производная от переписки, и чужому
    она не нужна. Пояс (`offset_minutes`) присылает клиент — он один знает
    местное время, а без сдвига «сообщений по дням» показало бы вечерние
    сообщения как ночные.
    """
    if not await crud.is_user_chat_member(session, chat_id=chat_id, user_id=user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=t("Статистика видна только участникам чата"),
        )
    stats = await crud.chat_stats(
        session, chat_id=chat_id, offset_minutes=offset_minutes
    )
    return ChatStats(**stats)


@router.post("/{chat_id}/members/", response_model=ChatSchema)
async def add_group_members(
    chat_id: int,
    payload: GroupMembersAdd,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Добавляет участников в группу (создатель/админ)."""
    await _ensure_group(await crud.get_chat_with_users(session, chat_id))

    actor_role = await crud.get_member_role(
        session=session, chat_id=chat_id, user_id=user.id
    )
    if actor_role not in ("creator", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=t("Недостаточно прав для добавления участников"),
        )

    added = await crud.add_group_members(
        session=session, chat_id=chat_id, user_ids=payload.user_ids
    )
    chat = await crud.get_chat_with_users(session, chat_id)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=t("Не удалось загрузить группу"),
        )
    for uid in added:
        await notify_user(
            uid,
            {"type": "chat.new", "chat_id": chat_id, "user_id": user.id},
        )
    if added:
        await notify_chat(
            session,
            chat_id=chat_id,
            payload={
                "type": "chat.updated",
                "chat_id": chat_id,
                "action": "members_added",
            },
            exclude_user_id=user.id,
        )
    return await _serialize_chat_full(session, chat, user.id)


@router.delete(
    "/{chat_id}/members/{user_id}/",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def kick_group_member(
    chat_id: int,
    user_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Исключает участника из группы (создатель/админ)."""
    await _ensure_group(await crud.get_chat_with_users(session, chat_id))
    await crud.kick_group_member(
        session=session, chat_id=chat_id, actor_id=user.id, user_id=user_id
    )
    return None


@router.patch(
    "/{chat_id}/members/{user_id}/role/",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def set_group_member_role(
    chat_id: int,
    user_id: int,
    payload: GroupRoleUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Назначает/снимает админа группы (только создатель)."""
    await _ensure_group(await crud.get_chat_with_users(session, chat_id))
    await crud.set_group_member_role(
        session=session,
        chat_id=chat_id,
        actor_id=user.id,
        user_id=user_id,
        role=payload.role,
    )
    return None


@router.post(
    "/{chat_id}/members/{user_id}/mute/",
    response_model=ChatDetail,
)
async def mute_group_member(
    chat_id: int,
    user_id: int,
    payload: GroupMuteUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Мут участника на N минут (None/0 — снять). Ответ — карточка группы."""
    await _ensure_group(await crud.get_chat_with_users(session, chat_id))
    await crud.set_member_mute(
        session=session,
        chat_id=chat_id,
        actor_id=user.id,
        user_id=user_id,
        minutes=payload.minutes,
    )
    chat = await crud.get_chat_with_users(session, chat_id)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=t("Не удалось загрузить группу"),
        )
    return await _serialize_group_detail(session, chat, user.id)


@router.post("/{chat_id}/members/{user_id}/ban/", response_model=ChatDetail)
async def ban_group_member(
    chat_id: int,
    user_id: int,
    payload: GroupBanCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Банит участника: исключает и закрывает вход обратно."""
    await _ensure_group(await crud.get_chat_with_users(session, chat_id))
    await crud.ban_group_member(
        session=session,
        chat_id=chat_id,
        actor_id=user.id,
        user_id=user_id,
        reason=payload.reason,
    )
    chat = await crud.get_chat_with_users(session, chat_id)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=t("Не удалось загрузить группу"),
        )
    return await _serialize_group_detail(session, chat, user.id)


@router.delete(
    "/{chat_id}/bans/{user_id}/",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unban_chat_member(
    chat_id: int,
    user_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Снимает бан: человек может вернуться по ссылке. Участником не становится."""
    await _ensure_group(await crud.get_chat_with_users(session, chat_id))
    await crud.unban_group_member(
        session=session, chat_id=chat_id, actor_id=user.id, user_id=user_id
    )
    return None


@router.get("/{chat_id}/bans/", response_model=list[ChatBanSchema])
async def get_chat_ban_list(
    chat_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Бан-лист группы (видят создатель и админы)."""
    await _ensure_group(await crud.get_chat_with_users(session, chat_id))
    actor_role = await crud.get_member_role(
        session=session, chat_id=chat_id, user_id=user.id
    )
    if actor_role not in ("creator", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=t("Бан-лист виден админам группы"),
        )
    bans = await crud.get_chat_bans(session, chat_id)
    return [
        ChatBanSchema(
            id=ban.id,
            user_id=ban.user_id,
            user=(
                ChatUserSchema(**_chat_user_payload(ban.user))
                if ban.user is not None
                else None
            ),
            reason=ban.reason,
            banned_at=ban.banned_at,
        )
        for ban in bans
    ]


@router.patch("/{chat_id}/slow-mode/", response_model=ChatSchema)
async def set_chat_slow_mode(
    chat_id: int,
    payload: GroupSlowModeUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Медленный режим группы: сколько секунд участник ждёт между сообщениями."""
    await _ensure_group(await crud.get_chat_with_users(session, chat_id))
    await crud.set_slow_mode(
        session=session, chat_id=chat_id, actor_id=user.id, seconds=payload.seconds
    )
    chat = await crud.get_chat_with_users(session, chat_id)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=t("Не удалось загрузить группу"),
        )
    return await _serialize_chat_full(session, chat, user.id)


@router.post("/{chat_id}/avatar/", response_model=ChatSchema)
async def upload_group_avatar(
    chat_id: int,
    request: Request,
    ext: str = Query(default="png", max_length=8),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Загружает аватар группы (тело — байты изображения)."""
    chat = await _ensure_group(await crud.get_chat_with_users(session, chat_id))

    actor_role = await crud.get_member_role(
        session=session, chat_id=chat_id, user_id=user.id
    )
    if actor_role not in ("creator", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=t("Менять аватар могут только создатель и админы"),
        )

    await enforce_limit(
        scope="chats:group_avatar",
        value=str(user.id),
        limit=settings.avatar_upload_limit_per_minute,
        window_seconds=60,
        detail=t("Слишком много запросов. Попробуйте позже."),
    )
    ext = ext.lower().lstrip(".")
    if ext not in ALLOWED_AVATAR_EXTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Недопустимый формат файла"),
        )

    content = await request.body()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Пустой файл"),
        )
    if len(content) > MAX_AVATAR_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=t("Файл слишком большой (максимум {mb} МБ)", mb=MAX_AVATAR_MB),
        )
    validate_image_upload(f"avatar.{ext}", content)

    _remove_chat_avatar_files(chat)
    avatar_url, avatar_thumb_url = store_avatar(
        content, prefix=f"chat_{chat.id}", extension=ext
    )
    chat.avatar_url = avatar_url
    chat.avatar_thumb_url = avatar_thumb_url
    await session.commit()

    await notify_chat(
        session,
        chat_id=chat_id,
        payload={
            "type": "chat.updated",
            "chat_id": chat_id,
            "action": "avatar",
        },
        exclude_user_id=user.id,
    )
    return await _serialize_chat_full(session, chat, user.id)


@router.delete("/{chat_id}/avatar/", response_model=ChatSchema)
async def delete_group_avatar(
    chat_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Удаляет аватар группы (создатель/админ)."""
    chat = await _ensure_group(await crud.get_chat_with_users(session, chat_id))

    actor_role = await crud.get_member_role(
        session=session, chat_id=chat_id, user_id=user.id
    )
    if actor_role not in ("creator", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=t("Менять аватар могут только создатель и админы"),
        )

    _remove_chat_avatar_files(chat)
    chat.avatar_url = None
    chat.avatar_thumb_url = None
    await session.commit()
    await notify_chat(
        session,
        chat_id=chat_id,
        payload={
            "type": "chat.updated",
            "chat_id": chat_id,
            "action": "avatar",
        },
        exclude_user_id=user.id,
    )
    return await _serialize_chat_full(session, chat, user.id)
