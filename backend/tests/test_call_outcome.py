"""Исход звонка в истории чата: «отклонил» против «не смог ответить».

Сервер видит сигналинг и пишет системное сообщение в личный чат
(``completed``/``missed``/``declined``). Причина отказа приходит в поле
``reason``:

* ``declined`` (или причина не указана) — человек нажал «Отклонить»;
* ``failed`` — нажал «Ответить», но не получилось (нет доступа к микрофону или
  камере);
* ``busy`` — уже разговаривает по другому вызову.

Раньше любой ``call-decline`` записывался как «отклонён» — и получалось, что
«Ответить» у собеседника выглядит как «Отклонить»: и в реплике истории чата, и в
ощущении зовущего. Здесь фиксируем правильную раскладку.
"""

from __future__ import annotations

import pytest

from api_v1.calls.views import _decline_state


@pytest.mark.parametrize(
    "reason,expected",
    [
        ("declined", "declined"),
        (None, "declined"),
        ("", "declined"),
        ("failed", "missed"),
        ("busy", "missed"),
    ],
)
def test_decline_state_by_reason(reason: str | None, expected: str) -> None:
    """«Не смог ответить» и «занят» — не отказ, а пропущенный звонок."""
    data: dict[str, object] = {"call_id": "call-1"}
    if reason is not None:
        data["reason"] = reason
    assert _decline_state(data) == expected


async def test_persisted_state_for_failed_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Проверяем сквозную запись: причину разбирает именно `_track_call_event`."""
    from api_v1.calls import views as calls_views

    saved: list[tuple[str, int]] = []

    async def fake_persist(meta: dict, state: str, duration: int) -> None:
        saved.append((state, duration))

    monkeypatch.setattr(calls_views, "_persist_call_record", fake_persist)
    calls_views._active_calls["call-failed"] = {
        "caller": 1,
        "callee": 2,
        "kind": "audio",
        "started": None,
    }

    # Абонент нажал «Ответить», но камера/микрофон оказались недоступны.
    await calls_views._track_call_event(
        "call-decline", 2, 1, {"call_id": "call-failed", "reason": "failed"}
    )
    # И второй случай: абонент был занят другим вызовом.
    calls_views._active_calls["call-busy"] = {
        "caller": 1,
        "callee": 2,
        "kind": "audio",
        "started": None,
    }
    await calls_views._track_call_event(
        "call-decline", 2, 1, {"call_id": "call-busy", "reason": "busy"}
    )
    # А это — настоящий отказ по кнопке «Отклонить».
    calls_views._active_calls["call-declined"] = {
        "caller": 1,
        "callee": 2,
        "kind": "audio",
        "started": None,
    }
    await calls_views._track_call_event(
        "call-decline", 2, 1, {"call_id": "call-declined", "reason": "declined"}
    )

    assert saved == [("missed", 0), ("missed", 0), ("declined", 0)]


@pytest.mark.parametrize(
    "message_type,data,expected",
    [
        ("call-answer", {}, "answered"),
        ("call-decline", {}, "declined"),
        ("call-decline", {"reason": "declined"}, "declined"),
        ("call-decline", {"reason": "failed"}, "failed"),
        ("call-decline", {"reason": "busy"}, "busy"),
        # Незнакомую причину не показываем как есть: на другом устройстве
        # подойдёт нейтральное «отклонён».
        ("call-decline", {"reason": "что-то"}, "declined"),
    ],
)
def test_elsewhere_reason(message_type: str, data: dict, expected: str) -> None:
    """Другие устройства человека узнают настоящую причину, а не «отклонил»."""
    from api_v1.calls.views import _elsewhere_reason

    assert _elsewhere_reason(message_type, data) == expected


async def test_other_devices_told_truth_and_notification_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Отказ «не смог ответить» уходит другим устройствам честно.

    И одновременно ставится тихий push: у устройств с закрытым приложением
    уведомление «Вам звонят» иначе висит до тапа, хотя звонок давно завершён.
    """
    from api_v1.calls import views as calls_views

    delivered: list[dict] = []
    finished: list[tuple[int, object]] = []

    async def fake_other_devices(
        user_id: int, payload: dict, exclude: object = None
    ) -> None:
        delivered.append(payload)

    async def fake_send_to_user(user_id: int, payload: dict) -> bool:
        return True

    monkeypatch.setattr(
        calls_views.call_manager, "send_to_other_devices", fake_other_devices
    )
    monkeypatch.setattr(calls_views.call_manager, "send_to_user", fake_send_to_user)
    monkeypatch.setattr(
        calls_views,
        "_notify_call_finished",
        lambda uid, call_id: finished.append((uid, call_id)),
    )
    monkeypatch.setattr(calls_views, "_track_call_event", _noop)
    monkeypatch.setattr(calls_views, "_is_call_blocked", _never_blocked)

    await calls_views._relay_message(
        1,
        {
            "type": "call-decline",
            "to_user_id": 2,
            "call_id": "call-7",
            "reason": "failed",
        },
    )

    assert delivered[0]["type"] == "call-ended-elsewhere"
    # Причина настоящая: человек пытался ответить, а не отклонил вызов.
    assert delivered[0]["reason"] == "failed"
    assert finished == [(1, "call-7")]


async def test_cancelled_call_closes_ring_notification(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Зовущий отменил вызов — у абонента уведомление тоже закрывается."""
    from api_v1.calls import views as calls_views

    finished: list[tuple[int, object]] = []

    async def fake_send_to_user(user_id: int, payload: dict) -> bool:
        return False

    monkeypatch.setattr(calls_views.call_manager, "send_to_user", fake_send_to_user)
    monkeypatch.setattr(calls_views.call_manager, "discard_pending_offer", _noop_two)
    monkeypatch.setattr(
        calls_views,
        "_notify_call_finished",
        lambda uid, call_id: finished.append((uid, call_id)),
    )
    monkeypatch.setattr(calls_views, "_track_call_event", _noop)
    monkeypatch.setattr(calls_views, "_is_call_blocked", _never_blocked)

    await calls_views._relay_message(
        1, {"type": "call-cancel", "to_user_id": 2, "call_id": "call-8"}
    )

    # Именно абонент (2), а не зовущий: уведомление висит у него.
    assert finished == [(2, "call-8")]


async def _noop(*args: object, **kwargs: object) -> None:
    return None


async def _noop_two(*args: object, **kwargs: object) -> None:
    return None


async def _never_blocked(*args: object, **kwargs: object) -> bool:
    return False
