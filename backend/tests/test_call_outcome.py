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
