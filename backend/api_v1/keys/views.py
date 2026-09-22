"""Эндпоинты ключей сквозного шифрования (E2EE).

Клиент (браузер) генерирует пару ключей ECDH P-256, приватную часть хранит
только у себя, публичную регистрирует здесь (``PUT /keys/me/``). Перед
шифрованием/расшифровкой сообщений клиент забирает публичный ключ
собеседника (``GET /keys/{user_id}/``). Сервер хранит только публичные ключи
и шифротекст и не может прочитать содержимое зашифрованных сообщений.

Для групповых чатов используется отдельный уровень: ключ группы (случайные
32 байта) раздаётся участникам «обёртками» (``PUT/GET /keys/group/{chat_id}/``)
— каждая обёртка зашифрована на общем секрете ECDH между раздавшим и
получателем, поэтому сервер ключ группы вычислить не может.

Для личных чатов с несколькими устройствами есть тот же механизм, но обёртки
персональные для каждого УСТРОЙСТВА (``PUT/GET /keys/chat/{chat_id}/``): ключ
чата раздаётся на телефон и на компьютер отдельно, иначе новое устройство
читало бы только сообщения, отправленные после его входа (см. ``ChatDeviceKey``).
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.i18n import t
from core.models import (
    Chat,
    ChatDeviceKey,
    ChatGroupKey,
    DeviceKey,
    User,
    db_helper,
    user_chat_association_table,
)
from core.timeutils import as_utc

from ..auth import audit, security_notifications
from ..auth.utils import get_current_user

router = APIRouter(prefix="/keys", tags=["E2EE-ключи"])


class PutMyKeyRequest(BaseModel):
    """Публичная часть ключа устройства (JWK), загружаемая на сервер."""

    public_key: str = Field(..., min_length=1, max_length=4096)
    #: Идентификатор устройства (клиент генерирует и хранит у себя). Старые
    #: клиенты его не присылают — тогда ключ пишется в строку `legacy`.
    device_id: str = Field(default="legacy", min_length=1, max_length=64)


class DeviceKeyItem(BaseModel):
    """Один публичный ключ устройства."""

    device_id: str
    public_key: str
    changed_at: str | None = None


class KeyResponse(BaseModel):
    user_id: int
    has_key: bool
    #: Ключ «основного» устройства (самое свежее обновление) — поле оставлено для
    #: совместимости: старый клиент шифрует только на него.
    public_key: str | None = None
    # Когда ключ последний раз менялся — собеседник по этому полю видит, что
    # устройство сменилось (и может предупредить о риске перехвата).
    changed_at: str | None = None
    #: Все устройства аккаунта: по ним шифруются обёртки ключа чата, чтобы
    #: переписку читали и телефон, и компьютер, а не только последнее вошедшее.
    devices: list[DeviceKeyItem] = []


@router.put("/me/", status_code=200)
async def put_my_key(
    payload: PutMyKeyRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, bool]:
    """Регистрирует/заменяет «текущий» публичный ключ моего устройства.

    Смена ключа — событие безопасности, а не техническая мелочь: с этого момента
    собеседники шифруют сообщения на НОВЫЙ ключ, и сторона, получившая доступ к
    аккаунту, могла бы подсунуть свой ключ и читать переписку (MITM). Поэтому о
    смене пишем в журнал и уведомляем владельца — письмом и push.
    """
    row = (
        await session.execute(
            select(DeviceKey).where(
                DeviceKey.user_id == user.id,
                DeviceKey.device_id == payload.device_id,
            )
        )
    ).scalar_one_or_none()
    changed = row is not None and row.public_key != payload.public_key
    if row is None:
        row = DeviceKey(
            user_id=user.id,
            device_id=payload.device_id,
            public_key=payload.public_key,
        )
        session.add(row)
    else:
        row.public_key = payload.public_key
    await session.commit()

    if changed:
        await audit.log_security_event(
            session,
            event="e2ee_key_changed",
            user_id=user.id,
            detail=t("публичный ключ шифрования устройства заменён"),
        )
        await security_notifications.notify_security_event(
            session,
            user,
            event="e2ee_key_changed",
            details=(
                "Ключ сквозного шифрования заменён (например, вход с нового "
                "устройства или очистка данных браузера).\nЕсли это были не вы — "
                "аккаунт мог быть угнан: смените пароль и нажмите «Выйти на всех "
                "устройствах»."
            ),
        )
    return {"ok": True, "changed": changed}


@router.get("/{user_id}/", response_model=KeyResponse)
async def get_user_key(
    user_id: int,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> KeyResponse:
    """Возвращает публичный ключ пользователя (или пустой, если ключа нет).

    Публичные ключи E2EE не являются секретом, поэтому доступны любому
    авторизованному пользователю.
    """
    rows = (
        (
            await session.execute(
                select(DeviceKey)
                .where(DeviceKey.user_id == user_id)
                .order_by(DeviceKey.updated_at.desc(), DeviceKey.id.desc())
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return KeyResponse(user_id=user_id, has_key=False, public_key=None)
    main = rows[0]
    changed_at = as_utc(main.updated_at)
    return KeyResponse(
        user_id=user_id,
        has_key=True,
        public_key=main.public_key,
        # Собеседник сравнивает ключ с тем, что видел раньше: расхождение —
        # повод предупредить человека (возможен перехват после угона аккаунта).
        changed_at=changed_at.isoformat() if changed_at is not None else None,
        devices=[
            DeviceKeyItem(
                device_id=row.device_id,
                public_key=row.public_key,
                changed_at=_iso_or_none(row.updated_at),
            )
            for row in rows
        ],
    )


def _iso_or_none(value: datetime | None) -> str | None:
    """Время в ISO (UTC) или None: `updated_at` может прийти пустым у старых строк."""
    moment = as_utc(value)
    return moment.isoformat() if moment is not None else None


# --------------------------------------------------------------------------
# Ключ группы (E2EE в групповых чатах)
# --------------------------------------------------------------------------


class GroupKeyEntry(BaseModel):
    """Обёртка ключа группы для одного участника."""

    user_id: int
    wrapped_key: str = Field(..., min_length=1, max_length=8192)


class PutGroupKeysRequest(BaseModel):
    """Набор обёрток: ``replace=true`` — сначала стереть прежние (ротация)."""

    keys: list[GroupKeyEntry] = Field(..., min_length=1, max_length=256)
    replace: bool = False


class GroupKeyResponse(BaseModel):
    chat_id: int
    has_key: bool
    wrapped_key: str | None = None
    wrapped_by: int | None = None


async def _ensure_member(session: AsyncSession, *, chat_id: int, user_id: int) -> None:
    """404, если пользователь не состоит в чате (не раскрываем чужие чаты)."""
    member_id = await session.scalar(
        select(user_chat_association_table.c.user_id).where(
            user_chat_association_table.c.chat_id == chat_id,
            user_chat_association_table.c.user_id == user_id,
        )
    )
    if member_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=t("Чат не найден"),
        )


async def _ensure_group_e2ee_chat(session: AsyncSession, chat_id: int) -> None:
    """400, если это не групповой чат или в нём не включено шифрование."""
    chat = await session.get(Chat, chat_id)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=t("Чат не найден"),
        )
    if not chat.is_group or not chat.e2ee_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Ключ группы доступен только для зашифрованных групп"),
        )


@router.get("/group/{chat_id}/", response_model=GroupKeyResponse)
async def get_my_group_key(
    chat_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> GroupKeyResponse:
    """Отдаёт МОЮ обёртку ключа группы (расшифровать её может только клиент)."""
    await _ensure_member(session, chat_id=chat_id, user_id=user.id)
    row = await session.get(ChatGroupKey, {"chat_id": chat_id, "user_id": user.id})
    if row is None:
        return GroupKeyResponse(chat_id=chat_id, has_key=False)
    return GroupKeyResponse(
        chat_id=chat_id,
        has_key=True,
        wrapped_key=row.wrapped_key,
        wrapped_by=row.wrapped_by,
    )


@router.put("/group/{chat_id}/", status_code=200)
async def put_group_keys(
    chat_id: int,
    payload: PutGroupKeysRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, int]:
    """Загружает обёртки ключа группы для участников (раздал их текущий юзер).

    Любой участник зашифрованной группы может раздать ключ (например, когда
    состав изменился, а создателя нет в сети) — проверяется только членство
    получателей и то, что чат действительно зашифрованная группа.
    """
    await _ensure_member(session, chat_id=chat_id, user_id=user.id)
    await _ensure_group_e2ee_chat(session, chat_id)

    target_ids = {entry.user_id for entry in payload.keys}
    member_ids = set(
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
    if not target_ids <= member_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Можно раздать ключ только участникам чата"),
        )

    if payload.replace:
        await session.execute(
            delete(ChatGroupKey).where(ChatGroupKey.chat_id == chat_id)
        )

    for entry in payload.keys:
        stmt = pg_insert(ChatGroupKey).values(
            chat_id=chat_id,
            user_id=entry.user_id,
            wrapped_key=entry.wrapped_key,
            wrapped_by=user.id,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[ChatGroupKey.chat_id, ChatGroupKey.user_id],
            set_={
                "wrapped_key": entry.wrapped_key,
                "wrapped_by": user.id,
            },
        )
        await session.execute(stmt)

    await session.commit()
    return {"count": len(payload.keys)}


# --------------------------------------------------------------------------
# Ключ чата по устройствам (E2EE в личных чатах, A5)
# --------------------------------------------------------------------------


class ChatDeviceKeyEntry(BaseModel):
    """Обёртка ключа чата для одного устройства участника."""

    user_id: int
    #: Устройство получателя; `legacy` — устройство старого клиента.
    device_id: str = Field(..., min_length=1, max_length=64)
    wrapped_key: str = Field(..., min_length=1, max_length=8192)


class PutChatDeviceKeysRequest(BaseModel):
    """Набор обёрток: ``replace=true`` — сначала стереть прежние (ротация)."""

    keys: list[ChatDeviceKeyEntry] = Field(..., min_length=1, max_length=256)
    replace: bool = False
    #: Моё устройство-раздатчик: получателю нужно знать, с чьим публичным
    #: ключом повторять ECDH, чтобы открыть обёртку.
    sender_device_id: str = Field(..., min_length=1, max_length=64)


class ChatDeviceKeyResponse(BaseModel):
    """Моя обёртка ключа чата для запрошенного устройства."""

    chat_id: int
    device_id: str
    has_key: bool
    wrapped_key: str | None = None
    #: Чьё устройство раздало обёртку — с его публичным ключом повторяется ECDH.
    wrapped_by_user_id: int | None = None
    wrapped_by_device_id: str | None = None


async def _member_ids(session: AsyncSession, chat_id: int) -> set[int]:
    """Участники чата (пустое множество — чата нет или он чужой)."""
    rows = await session.execute(
        select(user_chat_association_table.c.user_id).where(
            user_chat_association_table.c.chat_id == chat_id
        )
    )
    return set(rows.scalars().all())


@router.get("/chat/{chat_id}/", response_model=ChatDeviceKeyResponse)
async def get_my_chat_key(
    chat_id: int,
    device_id: Annotated[str, Query(min_length=1, max_length=64)],
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> ChatDeviceKeyResponse:
    """Отдаёт МОЮ обёртку ключа чата для этого устройства.

    Обёртку может открыть только само устройство: она зашифрована на общем
    секрете ECDH с устройством, которое её раздало.
    """
    await _ensure_member(session, chat_id=chat_id, user_id=user.id)
    row = await session.get(
        ChatDeviceKey,
        {"chat_id": chat_id, "user_id": user.id, "device_id": device_id},
    )
    if row is None:
        return ChatDeviceKeyResponse(
            chat_id=chat_id, device_id=device_id, has_key=False
        )
    return ChatDeviceKeyResponse(
        chat_id=chat_id,
        device_id=device_id,
        has_key=True,
        wrapped_key=row.wrapped_key,
        wrapped_by_user_id=row.wrapped_by_user_id,
        wrapped_by_device_id=row.wrapped_by_device_id,
    )


@router.put("/chat/{chat_id}/", status_code=200)
async def put_chat_device_keys(
    chat_id: int,
    payload: PutChatDeviceKeysRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, int]:
    """Загружает обёртки ключа чата для устройств участников.

    Раздавать может любой участник чата (как и в группах): ключ известен всем
    участникам, а проверяется только то, что получатели — участники, а их
    устройства действительно зарегистрированы (иначе обёртку некому открыть).
    Обёртки для незарегистрированных устройств молча пропускаются.
    """
    await _ensure_member(session, chat_id=chat_id, user_id=user.id)

    target_ids = {entry.user_id for entry in payload.keys}
    member_ids = await _member_ids(session, chat_id)
    if not member_ids or not target_ids <= member_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Можно раздать ключ только участникам чата"),
        )

    # Устройства получателей: (user_id, device_id) — по ним и пишем обёртки.
    known = set(
        (
            await session.execute(
                select(DeviceKey.user_id, DeviceKey.device_id).where(
                    DeviceKey.user_id.in_(target_ids)
                )
            )
        )
        .tuples()
        .all()
    )

    stored = 0
    if payload.replace:
        await session.execute(
            delete(ChatDeviceKey).where(ChatDeviceKey.chat_id == chat_id)
        )

    for entry in payload.keys:
        if (entry.user_id, entry.device_id) not in known:
            continue
        stmt = pg_insert(ChatDeviceKey).values(
            chat_id=chat_id,
            user_id=entry.user_id,
            device_id=entry.device_id,
            wrapped_key=entry.wrapped_key,
            wrapped_by_user_id=user.id,
            wrapped_by_device_id=payload.sender_device_id,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[
                ChatDeviceKey.chat_id,
                ChatDeviceKey.user_id,
                ChatDeviceKey.device_id,
            ],
            set_={
                "wrapped_key": entry.wrapped_key,
                "wrapped_by_user_id": user.id,
                "wrapped_by_device_id": payload.sender_device_id,
            },
        )
        await session.execute(stmt)
        stored += 1

    if stored == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Ни одно из устройств получателей не зарегистрировано"),
        )

    await session.commit()
    return {"count": stored}
