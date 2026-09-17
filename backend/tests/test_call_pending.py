"""Экран «Входящий звонок…»: живой ли ещё вызов.

Приложение открывается по push-уведомлению, пока сигнальный канал ещё
поднимается: сам вызов лежит в парковке на сервере (`park_offer`). Уведомление
может быть устаревшим — звонок давно отклонили, приняли на другом устройстве
или зовущий его отменил. Тогда парковки уже нет, и экран ждать не должен:
человек сидел бы перед «Входящий звонок…» до таймаута.

Здесь проверяем сам ответ сервера: `GET /calls/pending/` (см.
`api_v1/calls/views.pending_call`).
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from api_v1.calls import views as calls_views
from api_v1.calls.manager import call_manager
from core.models import PendingCallOffer, QueuedCallSignal, User, db_helper

needs_db = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)
pytestmark = needs_db


#: Участники тестов: зовущий и абонент. Парковка ссылается на `user` по FK,
#: поэтому пользователей нужно создать — иначе вставка не пройдёт.
CALLER_ID = 7
CALLEE_ID = 42


async def _clear_parking(session_factory) -> None:
    """Создаёт участников и чистит парковку с очередью сигналинга в БД.

    Раньше это было состояние в памяти процесса: теперь его видит любой процесс
    web (см. `api_v1/calls/store.py`), поэтому и чистить нужно общие таблицы.
    Пользователей создаём (а не чистим всю таблицу): парковка ссылается на
    `user` по внешнему ключу.
    """
    async with session_factory() as session:
        await session.execute(delete(PendingCallOffer))
        await session.execute(delete(QueuedCallSignal))
        for user_id, username in (
            (CALLER_ID, "pending_caller"),
            (CALLEE_ID, "pending_callee"),
        ):
            await session.execute(
                pg_insert(User)
                .values(
                    id=user_id,
                    username=username,
                    hashed_password="x",
                    is_active=True,
                    is_superuser=False,
                    is_verified=False,
                )
                .on_conflict_do_nothing(index_elements=[User.id])
            )
        await session.commit()


@pytest_asyncio.fixture
async def clean_parking(monkeypatch):
    """Свой движок на тестовую БД: глобальный `db_helper` привязан к своему loop.

    `pytest-asyncio` даёт каждому тесту новый event loop, а соединения из пула
    глобального движка принадлежат прошлому — обращение к ним падает с
    «another operation is in progress». Поэтому подменяем фабрику сессий у
    `db_helper` (её использует хранилище сигналинга) на движок этого теста.
    """
    engine = create_async_engine(os.environ["TEST_DATABASE_URL"])
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(db_helper, "session_factory", factory)
    await _clear_parking(factory)
    calls_views._active_calls.clear()
    yield
    await _clear_parking(factory)
    calls_views._active_calls.clear()
    await engine.dispose()


async def test_pending_call_reports_parked_offer(clean_parking) -> None:
    """Припаркованный вызов виден как «ждёт ответа»."""
    await call_manager.park_offer(
        42, {"type": "call-offer", "call_id": "call-1", "to_user_id": 42}
    )

    result = await calls_views.pending_call("call-1", user=type("U", (), {"id": 42})())

    assert result == {"pending": True, "ringing": False}


async def test_pending_call_reports_ringing_offer(clean_parking) -> None:
    """Свёрнутое приложение: парковки нет, но звонок идёт — «ringing».

    Именно по этому признаку кнопки уведомления (отказ, смахивание) понимают,
    что вызов ещё звонит: у свёрнутого приложения offer доставлен в открытую
    страницу, и парковки не будет — раньше отказ из-за этого не работал.
    """
    calls_views._active_calls["call-1"] = {
        "caller": 7,
        "callee": 42,
        "kind": "audio",
        "started": None,
    }

    result = await calls_views.pending_call("call-1", user=type("U", (), {"id": 42})())

    assert result == {"pending": False, "ringing": True}


async def test_pending_call_not_ringing_after_answer(clean_parking) -> None:
    """Звонок приняли — звонить больше нечему, отказ не нужен."""
    calls_views._active_calls["call-1"] = {
        "caller": 7,
        "callee": 42,
        "kind": "audio",
        "started": datetime.now(timezone.utc),
    }

    result = await calls_views.pending_call("call-1", user=type("U", (), {"id": 42})())

    assert result == {"pending": False, "ringing": False}


async def test_pending_call_ringing_only_for_callee(clean_parking) -> None:
    """«Звонит» — только тому, кому звонят: у зовущего спрашивать нечего."""
    calls_views._active_calls["call-1"] = {
        "caller": 7,
        "callee": 42,
        "kind": "audio",
        "started": None,
    }

    result = await calls_views.pending_call("call-1", user=type("U", (), {"id": 7})())

    assert result == {"pending": False, "ringing": False}


async def test_pending_call_hides_resolved_call(clean_parking) -> None:
    """Отклонённый/принятый вызов: парковки нет — экран закрывается сразу."""
    await call_manager.park_offer(
        42, {"type": "call-offer", "call_id": "call-1", "to_user_id": 42}
    )
    await call_manager.discard_pending_offer(42, "call-1")

    result = await calls_views.pending_call("call-1", user=type("U", (), {"id": 42})())

    assert result == {"pending": False, "ringing": False}


async def test_pending_call_ignores_other_call(clean_parking) -> None:
    """Ждёт ДРУГОЙ вызов — про этот (из устаревшего уведомления) ответ «нет»."""
    await call_manager.park_offer(
        42, {"type": "call-offer", "call_id": "call-2", "to_user_id": 42}
    )

    result = await calls_views.pending_call("call-1", user=type("U", (), {"id": 42})())

    assert result == {"pending": False, "ringing": False}


async def test_pending_call_without_id(clean_parking) -> None:
    """Без номера вызова спрашивать нечего."""
    result = await calls_views.pending_call("", user=type("U", (), {"id": 42})())

    assert result == {"pending": False, "ringing": False}


async def test_queued_signals_keep_order_and_drop_expired(clean_parking) -> None:
    """Очередь сигналинга: порядок сохраняем, просроченное не отдаём.

    Порядок важен: ответ на звонок, а за ним ICE-кандидаты — если отдать их
    наоборот, приложение получит кандидатов раньше ответа и соединение соберётся
    позже, чем могло бы.
    """
    from api_v1.calls import store

    await store.queue_signal(CALLEE_ID, {"type": "call-answer"}, 60, max_messages=10)
    await store.queue_signal(CALLEE_ID, {"type": "ice-candidate"}, 60, max_messages=10)
    # Просроченное сообщение (срок уже вышел) отдавать нельзя.
    await store.queue_signal(CALLEE_ID, {"type": "call-end"}, -1, max_messages=10)

    queued = await store.take_queued_signals(CALLEE_ID)
    assert [item["type"] for item in queued] == ["call-answer", "ice-candidate"]
    # Очередь опустела: второй раз отдавать нечего.
    assert await store.take_queued_signals(CALLEE_ID) == []


async def test_queue_drops_oldest_beyond_limit(clean_parking) -> None:
    """«Мёртвый» сокет не копит сообщения: в очереди остаётся только хвост."""
    from api_v1.calls import store

    for index in range(5):
        await store.queue_signal(
            CALLEE_ID, {"type": f"sig-{index}"}, 60, max_messages=3
        )

    queued = await store.take_queued_signals(CALLEE_ID)
    assert [item["type"] for item in queued] == ["sig-2", "sig-3", "sig-4"]


async def test_prune_removes_expired_parking(clean_parking) -> None:
    """Уборка по расписанию чистит и парковку, и очередь."""
    from api_v1.calls import store

    await call_manager.park_offer(
        CALLEE_ID, {"type": "call-offer", "call_id": "call-1"}, ttl_seconds=-1
    )
    await store.queue_signal(CALLEE_ID, {"type": "call-end"}, -1, max_messages=10)

    await store.prune_expired_signals()

    assert await store.has_pending_offer(CALLEE_ID) is False
    assert await store.take_queued_signals(CALLEE_ID) == []
