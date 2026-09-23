"""Хранилище сигналинга звонков, переживающее процесс web.

Зачем: пока припаркованный вызов и недоставленный сигналинг жили в памяти
процесса (`api_v1/calls/manager.py`), при нескольких процессах web (деплой
«синий/зелёный», масштабирование) они терялись: абонент, открывший приложение на
ДРУГОМ слоте, не получал парковку, а зовущий не получал ответ/завершение.

Теперь это две таблицы:

* ``pending_call_offers`` — по одной парковке на абонента (входящий вызов, когда
  приложение закрыто): любой процесс положит и любой заберёт;
* ``queued_call_signals`` — недоставленные сигнальные сообщения (ответ на звонок,
  ICE-кандидаты, завершение): их может быть несколько, порядок сохраняем.

Срок жизни считаем по ``expires_at`` (naive UTC, как ``messages.timestamp``) и
чистим лениво — вместе с чтением, чтобы не заводить отдельную задачу.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import PendingCallOffer, QueuedCallSignal, db_helper


def _now() -> datetime:
    """Naive UTC: колонки времени в проекте без зоны (см. `messages.timestamp`)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _expires_in(ttl_seconds: float) -> datetime:
    return _now() + timedelta(seconds=max(0.0, ttl_seconds))


async def park_offer(
    user_id: int, call_id: str | None, payload: dict[str, Any], ttl_seconds: float
) -> None:
    """Кладёт (или заменяет) парковку входящего вызова для абонента."""
    async with db_helper.session_factory() as session:
        statement = pg_insert(PendingCallOffer).values(
            user_id=user_id,
            call_id=call_id,
            payload=payload,
            expires_at=_expires_in(ttl_seconds),
        )
        # Новый вызов вытесняет старую парковку: одновременно звонить могут только
        # одним вызовом, а «висящая» парковка от прошлого звонка заставила бы
        # абонента ответить на давно завершённый.
        statement = statement.on_conflict_do_update(
            index_elements=[PendingCallOffer.user_id],
            set_={
                "call_id": statement.excluded.call_id,
                "payload": statement.excluded.payload,
                "expires_at": statement.excluded.expires_at,
            },
        )
        await session.execute(statement)
        await session.commit()


async def take_pending_offer(user_id: int) -> dict[str, Any] | None:
    """Забирает парковку абонента (просроченную выбрасывает)."""
    async with db_helper.session_factory() as session:
        offer = await session.scalar(
            select(PendingCallOffer).where(PendingCallOffer.user_id == user_id)
        )
        if offer is None:
            return None
        payload = dict(offer.payload or {})
        expires_at = offer.expires_at
        await session.execute(
            delete(PendingCallOffer).where(PendingCallOffer.user_id == user_id)
        )
        await session.commit()
    if expires_at is not None and expires_at < _now():
        return None
    return payload


async def has_pending_offer(user_id: int, call_id: str | None = None) -> bool:
    """Ждёт ли абонента ещё не истёкший входящий вызов."""
    async with db_helper.session_factory() as session:
        offer = await session.scalar(
            select(PendingCallOffer).where(PendingCallOffer.user_id == user_id)
        )
    if offer is None:
        return False
    if offer.expires_at is not None and offer.expires_at < _now():
        return False
    if call_id and offer.call_id != call_id:
        return False
    return True


async def discard_pending_offer(user_id: int, call_id: str | None) -> None:
    """Убирает парковку, если она относится к указанному вызову."""
    if not call_id:
        return
    async with db_helper.session_factory() as session:
        await session.execute(
            delete(PendingCallOffer).where(
                PendingCallOffer.user_id == user_id,
                PendingCallOffer.call_id == call_id,
            )
        )
        await session.commit()


async def queue_signal(
    user_id: int,
    payload: dict[str, Any],
    ttl_seconds: float,
    *,
    max_messages: int,
) -> None:
    """Придерживает сигнальное сообщение до следующего подключения абонента."""
    async with db_helper.session_factory() as session:
        await _delete_expired(session, user_id)
        session.add(
            QueuedCallSignal(
                user_id=user_id,
                payload=payload,
                expires_at=_expires_in(ttl_seconds),
            )
        )
        # Обрезку делаем ПОСЛЕ вставки: иначе предел превышался бы на одно
        # сообщение при каждом добавлении.
        await session.flush()
        await _trim(session, user_id, max_messages)
        await session.commit()


async def take_queued_signals(user_id: int) -> list[dict[str, Any]]:
    """Отдаёт придержанные сообщения абонента в порядке добавления."""
    async with db_helper.session_factory() as session:
        rows = (
            (
                await session.execute(
                    select(QueuedCallSignal)
                    .where(
                        QueuedCallSignal.user_id == user_id,
                        QueuedCallSignal.expires_at >= _now(),
                    )
                    .order_by(QueuedCallSignal.id)
                )
            )
            .scalars()
            .all()
        )
        await session.execute(
            delete(QueuedCallSignal).where(QueuedCallSignal.user_id == user_id)
        )
        await session.commit()
    return [dict(row.payload or {}) for row in rows]


async def prune_expired_signals(session: AsyncSession | None = None) -> None:
    """Чистит истёкшие парковки и очередь (зовётся по расписанию задач).

    ``session`` передаёт воркер (``tasks/call_tasks.py``): у фоновых задач свой
    движок на каждый цикл событий (см. ``tasks/base.py``), а общий ``db_helper``
    для них не годится — его пул живёт весь процесс воркера, и соединения
    остаются привязаны к ПРОШЛОМУ event loop. Из-за этого задача падала с
    ``InterfaceError: cannot perform operation: another operation is in
    progress`` / ``RuntimeError: attached to a different loop`` (29 падений за
    сутки 23.09.2026). Из web-процесса сессию не передают — работает общий
    ``db_helper``, как раньше.
    """
    if session is not None:
        await _prune_expired(session)
        await session.commit()
        return

    async with db_helper.session_factory() as own:
        await _prune_expired(own)
        await own.commit()


async def _prune_expired(session: AsyncSession) -> None:
    """Удаления без ``commit``: решает вызывающий (своя сессия или общая)."""
    await session.execute(
        delete(PendingCallOffer).where(PendingCallOffer.expires_at < _now())
    )
    await session.execute(
        delete(QueuedCallSignal).where(QueuedCallSignal.expires_at < _now())
    )


async def _delete_expired(session: AsyncSession, user_id: int) -> None:
    """Ленивая чистка истёкших сообщений абонента."""
    await session.execute(
        delete(QueuedCallSignal).where(
            QueuedCallSignal.user_id == user_id,
            QueuedCallSignal.expires_at < _now(),
        )
    )


async def _trim(session: AsyncSession, user_id: int, max_messages: int) -> None:
    """Оставляет только `max_messages` самых новых сообщений абонента."""
    ids = (
        (
            await session.execute(
                select(QueuedCallSignal.id)
                .where(QueuedCallSignal.user_id == user_id)
                .order_by(QueuedCallSignal.id.desc())
                .offset(max_messages)
            )
        )
        .scalars()
        .all()
    )
    if ids:
        # «Мёртвый» сокет не должен копить сообщения: старые выкидываем.
        await session.execute(
            delete(QueuedCallSignal).where(QueuedCallSignal.id.in_(list(ids)))
        )
