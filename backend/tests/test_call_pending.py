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

import pytest

from api_v1.calls import views as calls_views
from api_v1.calls.manager import call_manager


@pytest.fixture
def clean_parking():
    """Парковка — общее состояние менеджера: чистим до и после теста."""
    call_manager._pending_offers.clear()
    yield
    call_manager._pending_offers.clear()


async def test_pending_call_reports_parked_offer(clean_parking) -> None:
    """Припаркованный вызов виден как «ждёт ответа»."""
    await call_manager.park_offer(
        42, {"type": "call-offer", "call_id": "call-1", "to_user_id": 42}
    )

    result = await calls_views.pending_call("call-1", user=type("U", (), {"id": 42})())

    assert result == {"pending": True}


async def test_pending_call_hides_resolved_call(clean_parking) -> None:
    """Отклонённый/принятый вызов: парковки нет — экран закрывается сразу."""
    await call_manager.park_offer(
        42, {"type": "call-offer", "call_id": "call-1", "to_user_id": 42}
    )
    await call_manager.discard_pending_offer(42, "call-1")

    result = await calls_views.pending_call("call-1", user=type("U", (), {"id": 42})())

    assert result == {"pending": False}


async def test_pending_call_ignores_other_call(clean_parking) -> None:
    """Ждёт ДРУГОЙ вызов — про этот (из устаревшего уведомления) ответ «нет»."""
    await call_manager.park_offer(
        42, {"type": "call-offer", "call_id": "call-2", "to_user_id": 42}
    )

    result = await calls_views.pending_call("call-1", user=type("U", (), {"id": 42})())

    assert result == {"pending": False}


async def test_pending_call_without_id(clean_parking) -> None:
    """Без номера вызова спрашивать нечего."""
    result = await calls_views.pending_call("", user=type("U", (), {"id": 42})())

    assert result == {"pending": False}
