"""Pydantic-схемы чатов."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from api_v1.messages.schemas import Message as MessageSchema


class PrivateChatCreate(BaseModel):
    user_id: int


class ChatUserSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    first_name: str | None = None
    last_name: str | None = None
    phone_number: str | None = None
    avatar_url: str | None = None
    # Маленькая копия аватара для списков (None — показываем оригинал).
    avatar_thumb_url: str | None = None
    status: str | None = None
    last_seen: datetime | None = None


class ChatMemberSchema(ChatUserSchema):
    """Участник чата с ролью (для карточки группы)."""

    role: str = "member"
    joined_at: datetime | None = None


class Chat(BaseModel):
    id: int
    name: str
    users: list[ChatUserSchema] = []
    last_message: MessageSchema | None = None
    unread_count: int = 0
    # Замьючен ли чат для текущего пользователя (без уведомлений).
    muted: bool = False
    # Тип чата: True — «зашифрованный» (E2EE), False — «обычный». По умолчанию обычный.
    e2ee_enabled: bool = False
    # «Сохранённые сообщения» (личный чат с собой).
    is_self: bool = False
    # Групповой ли это чат.
    is_group: bool = False
    # Аватар группового чата (путь /media/...).
    avatar_url: str | None = None
    # Маленькая копия аватара группы для списков (None — показываем оригинал).
    avatar_thumb_url: str | None = None
    # Описание группы.
    description: str | None = None
    # Количество участников (для групп).
    member_count: int = 0
    # Роль текущего пользователя в группе (creator/admin/member).
    my_role: str = "member"
    # Создатель группы.
    creator_id: int | None = None


class ChatDetail(Chat):
    """Карточка чата вместе с полным списком участников и их ролями."""

    members: list[ChatMemberSchema] = []


class ChatE2eeUpdate(BaseModel):
    """Переключение типа чата (обычный/зашифрованный)."""

    enabled: bool


class GroupCreate(BaseModel):
    """Создание группового чата."""

    name: str = Field(..., min_length=1, max_length=100)
    user_ids: list[int] = Field(..., min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1024)


class GroupUpdate(BaseModel):
    """Изменение названия/описания группы (только создатель/админ)."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=1024)


class GroupMembersAdd(BaseModel):
    """Добавление участников в группу."""

    user_ids: list[int] = Field(..., min_length=1, max_length=200)


class GroupRoleUpdate(BaseModel):
    """Назначение/снятие админа (только создатель)."""

    role: Literal["admin", "member"]


class GroupInviteCreate(BaseModel):
    """Создание ссылки-приглашения в группу."""

    #: Срок годности в часах (None — ссылка без срока).
    expires_in_hours: int | None = Field(default=None, ge=1, le=24 * 365)
    #: Сколько раз по ссылке можно войти (None — без ограничения).
    max_uses: int | None = Field(default=None, ge=1, le=1000)


class GroupInvite(BaseModel):
    """Ссылка-приглашение (для создателя и админов группы)."""

    id: int
    token: str
    #: Путь для ссылки: `/j/<token>`. Полный адрес собирает клиент, потому что
    #: только он знает свой origin (в разработке это localhost, в проде — домен).
    path: str
    created_at: datetime
    expires_at: datetime | None = None
    max_uses: int | None = None
    uses: int = 0
    revoked: bool = False
    #: Ссылка ещё работает (не отозвана, не истекла, не исчерпана).
    active: bool = True


class GroupInvitePreview(BaseModel):
    """Что видит приглашённый до вступления (карточка группы)."""

    chat_id: int
    name: str
    description: str | None = None
    avatar_url: str | None = None
    avatar_thumb_url: str | None = None
    member_count: int = 0
    #: Он уже в группе — вступать не нужно, просто открываем чат.
    is_member: bool = False
    #: Ссылка уже не работает (отозвана/истекла/исчерпана) — причина в detail.
    expired: bool = False


class GroupJoinResult(BaseModel):
    """Результат входа по ссылке: карточку чата клиент берёт из списка чатов."""

    chat_id: int
    name: str
