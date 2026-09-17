"""Выборка истории звонков.

Записи о звонках — не отдельная таблица, а системные сообщения личного чата
(`Message.kind == "call"`, см. `api_v1/calls/views.py::_persist_call_record`).
Поэтому история звонков — это те же сообщения, только собранные по всем личным
чатам человека и отсортированные по времени: отдельного хранилища не заводим,
иначе записи пришлось бы синхронизировать с лентой чата и они разъезжались бы
(звонок есть в истории, а в чате — нет).
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Message, User
from core.models.associations import user_chat_association_table


async def get_call_history(
    session: AsyncSession,
    *,
    user_id: int,
    limit: int,
    offset: int,
) -> tuple[list[dict], int]:
    """История звонков человека: страница записей и их общее число.

    Отдаём именно звонки, а не сообщения: `peer` — собеседник из того же личного
    чата (у записи о звонке чат всегда парный), `outgoing` — звонил ли сам
    человек. Скрытые модерацией записи не показываем: жалоба могла быть и на
    запись о звонке, а «скрытое» в истории выглядело бы как обычный звонок.
    """
    my_chat_ids = select(user_chat_association_table.c.chat_id).where(
        user_chat_association_table.c.user_id == user_id
    )
    scope = (
        Message.kind == "call",
        Message.chat_id.in_(my_chat_ids),
        Message.hidden_at.is_(None),
    )

    total = await session.scalar(
        select(func.count()).select_from(Message).where(*scope)
    )
    rows = (
        (
            await session.execute(
                select(Message)
                .where(*scope)
                # id вторым ключом: у записей, созданных в одну секунду (звонок
                # и его завершение), порядок иначе плавал бы между страницами.
                .order_by(Message.timestamp.desc(), Message.id.desc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )

    peers = await _peers_by_chat(
        session, chat_ids={row.chat_id for row in rows}, user_id=user_id
    )

    items = [
        {
            "id": row.id,
            "chat_id": row.chat_id,
            "peer": peers.get(row.chat_id),
            "call_kind": row.call_kind or "audio",
            "call_state": row.call_state or "completed",
            "call_duration": int(row.call_duration or 0),
            "timestamp": row.timestamp,
            # Инициатор хранится в call_caller_id; у старых записей его нет —
            # тогда автором сообщения был зовущий (см. _persist_call_record).
            "outgoing": (row.call_caller_id or row.user_id) == user_id,
        }
        for row in rows
    ]
    return items, int(total or 0)


async def _peers_by_chat(
    session: AsyncSession, *, chat_ids: set[int], user_id: int
) -> dict[int, User]:
    """Собеседник каждого чата: участник, который не я.

    У записи о звонке чат всегда парный, поэтому собеседник один. Если участник
    удалил аккаунт, он в выборку не попадёт — клиент покажет «Удалённый аккаунт»
    (поле `peer` будет пустым, а не ошибкой).
    """
    if not chat_ids:
        return {}
    rows = (
        await session.execute(
            select(user_chat_association_table.c.chat_id, User)
            .join(User, User.id == user_chat_association_table.c.user_id)
            .where(
                user_chat_association_table.c.chat_id.in_(chat_ids),
                user_chat_association_table.c.user_id != user_id,
            )
        )
    ).all()
    peers: dict[int, User] = {}
    for chat_id, peer in rows:
        # Первый участник «побеждает»: для парного чата он единственный.
        peers.setdefault(chat_id, peer)
    return peers
