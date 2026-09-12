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

from datetime import datetime, timezone

import pytest

from api_v1.calls import views as calls_views
from api_v1.calls.manager import call_manager


@pytest.fixture
def clean_parking():
    """Парковка и состояние звонков — общие: чистим до и после теста."""
    call_manager._pending_offers.clear()
    calls_views._active_calls.clear()
    yield
    call_manager._pending_offers.clear()
    calls_views._active_calls.clear()


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
