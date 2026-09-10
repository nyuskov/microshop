"""Тесты «белого списка» сигнальных сообщений звонков.

Сервер — ретранслятор: он пропускает только типы из ``RELAY_MESSAGE_TYPES``.
Если новый тип клиента (например, пересогласование SDP для демонстрации экрана)
забыть добавить в набор, фронтенд молча перестанет получать сообщения — тест
фиксирует этот контракт.
"""

from api_v1.calls.views import RELAY_MESSAGE_TYPES, _track_call_event


def test_relay_whitelist_covers_call_flow() -> None:
    """Базовые шаги звонка + пересогласование/демонстрация экрана пересылаются."""
    required = {
        "call-offer",
        "call-answer",
        "ice-candidate",
        "call-cancel",
        "call-decline",
        "call-end",
    }
    assert required <= RELAY_MESSAGE_TYPES


def test_relay_whitelist_covers_screen_share() -> None:
    """Демонстрация экрана требует пересогласования SDP и статуса показа."""
    screen_share = {
        "call-renegotiate",
        "call-renegotiate-answer",
        "call-screen",
    }
    assert screen_share <= RELAY_MESSAGE_TYPES


async def test_track_call_event_ignores_unknown_types() -> None:
    """Новые типы не должны ломать запись истории звонков (и не создавать её)."""
    # Пересогласование приходит с чужим/отсутствующим call_id — обработчик обязан
    # молча выйти, а не упасть.
    await _track_call_event("call-screen", 1, 2, {"sharing": True})
    await _track_call_event("call-renegotiate", 1, 2, {"call_id": "unknown"})
    await _track_call_event("call-renegotiate-answer", 1, 2, {"call_id": "unknown"})
