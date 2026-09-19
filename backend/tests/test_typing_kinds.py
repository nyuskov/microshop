"""Виды активности собеседника: «печатает…», «записывает голосовое…» и прочие.

Сервер только ретранслирует вид активности участникам чата (кроме автора), но
обязан проверять его по списку: строка из сети не должна уходить собеседникам
как есть. События старого клиента (без вида) считаются набором текста.
"""

from __future__ import annotations

from typing import Any

import pytest

from api_v1.events import views as events_views


class FakeSession:
    """Асинхронный контекст сессии: обработчику нужен только факт входа."""

    async def __aenter__(self) -> FakeSession:
        return self

    async def __aexit__(self, *args: object) -> None:
        return None


@pytest.fixture
def broadcast(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Перехватывает рассылку и считает участников чата [7, 8, 9]."""
    sent: list[dict[str, Any]] = []

    async def fake_dispatch(recipients: list[int], payload: dict[str, Any]) -> None:
        sent.append({"recipients": list(recipients), **payload})

    async def fake_members(_session: object, chat_id: int) -> list[int]:
        assert chat_id == 40
        return [7, 8, 9]

    monkeypatch.setattr(events_views, "dispatch_realtime", fake_dispatch)
    monkeypatch.setattr(events_views, "chat_member_ids", fake_members)
    monkeypatch.setattr(
        events_views,
        "db_helper",
        type("DB", (), {"session_factory": staticmethod(FakeSession)}),
    )
    return sent


async def _handle(data: Any) -> None:
    await events_views._handle_client_event(7, data)


@pytest.mark.asyncio
async def test_typing_without_kind_is_text(broadcast: list[dict[str, Any]]) -> None:
    """Старый клиент шлёт `typing` без вида — это набор текста."""
    await _handle({"type": "typing", "chat_id": 40})

    assert broadcast == [
        {
            "recipients": [8, 9],
            "type": "typing",
            "chat_id": 40,
            "user_id": 7,
            "kind": "text",
        }
    ]


@pytest.mark.asyncio
async def test_voice_activity_is_relayed(broadcast: list[dict[str, Any]]) -> None:
    """Вид «записывает голосовое» доходит до собеседников как есть."""
    await _handle({"type": "typing", "chat_id": 40, "kind": "voice"})

    assert broadcast[0]["kind"] == "voice"
    assert broadcast[0]["user_id"] == 7


@pytest.mark.asyncio
async def test_unknown_kind_falls_back_to_text(broadcast: list[dict[str, Any]]) -> None:
    """Незнакомый вид не пересылаем: подставляем набор текста."""
    await _handle({"type": "typing", "chat_id": 40, "kind": "что-угодно"})

    assert broadcast[0]["kind"] == "text"


@pytest.mark.asyncio
async def test_stop_has_no_kind(broadcast: list[dict[str, Any]]) -> None:
    """Остановка гасит любую активность — вид ей не нужен."""
    await _handle({"type": "typing-stop", "chat_id": 40})

    assert broadcast == [
        {"recipients": [8, 9], "type": "typing-stop", "chat_id": 40, "user_id": 7}
    ]


@pytest.mark.asyncio
async def test_author_does_not_receive_own_activity(
    broadcast: list[dict[str, Any]],
) -> None:
    """Своя же активность автору не приходит (иначе он видит «печатает…» у себя)."""
    await _handle({"type": "typing", "chat_id": 40, "kind": "file"})

    assert 7 not in broadcast[0]["recipients"]


@pytest.mark.asyncio
async def test_stranger_gets_nothing(
    broadcast: list[dict[str, Any]], monkeypatch
) -> None:
    """Чужой чат: не участник — ничего не рассылаем."""

    async def fake_members(_session: object, _chat_id: int) -> list[int]:
        return [8, 9]

    monkeypatch.setattr(events_views, "chat_member_ids", fake_members)

    await _handle({"type": "typing", "chat_id": 40, "kind": "video"})

    assert broadcast == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "broken", [None, "typing", {"type": "typing"}, {"type": "typing", "chat_id": "x"}]
)
async def test_broken_payload_ignored(
    broadcast: list[dict[str, Any]], broken: Any
) -> None:
    """Мусор в событии не должен ничего рассылать или ронять канал."""
    await _handle(broken)

    assert broadcast == []


def test_kind_list_is_documented() -> None:
    """Список видов известен серверу: он и есть контракт с клиентом."""
    assert events_views.TYPING_KINDS == {
        "text",
        "voice",
        "video_note",
        "photo",
        "video",
        "file",
    }
    assert events_views.TYPING_KIND_DEFAULT in events_views.TYPING_KINDS
