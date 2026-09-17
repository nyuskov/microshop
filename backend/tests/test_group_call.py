"""Серверные правила группового звонка «mesh» (пункт B2 плана).

Схема полносвязная: каждый участник держит соединение с каждым, медиа идёт
напрямую (поэтому сквозное шифрование сохраняется). Сервер — ретранслятор, но
две вещи он обязан проверять сам, иначе клиентский лимит обходится:

* чат действительно групповой и оба участника в нём состоят (иначе чужой чат
  получил бы сигналинг);
* в звонке не больше четырёх человек (дальше квадратично растут трафик и
  нагрузка на слабых телефонах).

Ещё сервер рассылает состав звонка (`call-peers`) — без него «mesh» не собрать:
клиенты должны знать, с кем соединяться.
"""

from __future__ import annotations

import os

import pytest
import pytest_asyncio

from api_v1.calls import views as calls_views
from api_v1.calls.views import (
    MAX_GROUP_CALL_PARTICIPANTS,
    _group_call_peers,
    _group_calls,
)
from tests.test_messenger_api import _ApiCtx  # noqa: E402
from tests.test_messenger_api import api as api_fixture  # noqa: E402

api = api_fixture

needs_db = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


@pytest_asyncio.fixture
async def group_call(api: _ApiCtx, call_signals) -> dict:
    """Группа с четырьмя участниками и чистый реестр групповых звонков.

    `call_signals` подменяет фабрику сессий на движок текущего теста: у
    `pytest-asyncio` свой цикл событий на каждый тест, а пул глобального
    `db_helper` к нему не привязан (иначе «another operation is in progress»).
    """
    owner = await api.make_user()
    owner_token = await api.token_for(owner)
    # Участников чата больше, чем мест в звонке: так проверяется лимит.
    members = [await api.make_user() for _ in range(4)]
    response = await api.client.post(
        "/api/v1/chats/groups/",
        json={"name": "Группа", "user_ids": [member.id for member in members]},
        headers=api.auth(owner_token),
    )
    assert response.status_code == 200, response.text
    chat = response.json()
    _group_calls.clear()
    try:
        yield {"owner": owner, "members": members, "chat": chat, "api": api}
    finally:
        _group_calls.clear()


@needs_db
@pytest.mark.usefixtures("group_call")
def test_limit_is_four_participants() -> None:
    """Лимит держится согласованным и не равен «безлимиту»."""
    assert MAX_GROUP_CALL_PARTICIPANTS == 4


@needs_db
async def test_outsider_cannot_join_group_call(group_call: dict) -> None:
    """Посторонний (не участник группы) не проходит проверку чата."""
    api: _ApiCtx = group_call["api"]
    outsider = await api.make_user()
    ok, reason = await calls_views._admit_group_call(
        {"call_id": "call-outsider", "chat_id": group_call["chat"]["id"]},
        from_user_id=group_call["owner"].id,
        to_user_id=outsider.id,
    )
    assert (ok, reason) == (False, "forbidden")
    assert _group_call_peers("call-outsider") == []


@needs_db
async def test_private_chat_is_not_a_group_call(group_call: dict) -> None:
    """В личном чате групповой режим не включается: сетка «каждый с каждым» не нужна."""
    api: _ApiCtx = group_call["api"]
    owner = group_call["owner"]
    member = group_call["members"][0]
    owner_token = await api.token_for(owner)
    private_chat = await api.private_chat(owner_token, member.id)

    # Чат для группового звонка обязан быть группой: проверка отсекает личные.
    assert await calls_views._group_chat_member_ids(private_chat["id"]) is None
    ok, reason = await calls_views._admit_group_call(
        {"call_id": "call-private", "chat_id": private_chat["id"]},
        from_user_id=owner.id,
        to_user_id=member.id,
    )
    assert (ok, reason) == (False, "forbidden")


@needs_db
async def test_members_are_admitted_and_listed(group_call: dict) -> None:
    """Все участники группы попадают в звонок, состав отдаётся целиком."""
    owner = group_call["owner"]
    members = group_call["members"]
    call_id = "call-members"
    chat_id = group_call["chat"]["id"]

    admitted = members[: MAX_GROUP_CALL_PARTICIPANTS - 1]
    for member in admitted:
        ok, reason = await calls_views._admit_group_call(
            {"call_id": call_id, "chat_id": chat_id},
            from_user_id=owner.id,
            to_user_id=member.id,
        )
        assert (ok, reason) == (True, "")

    assert _group_call_peers(call_id) == sorted([owner.id] + [m.id for m in admitted])


@needs_db
async def test_fifth_participant_is_rejected(group_call: dict) -> None:
    """Пятый получает «full»: в звонке уже максимум человек."""
    owner = group_call["owner"]
    members = group_call["members"]
    chat_id = group_call["chat"]["id"]
    call_id = "call-full"

    # Зовущий + трое = предел (четыре человека).
    for member in members[: MAX_GROUP_CALL_PARTICIPANTS - 1]:
        ok, _ = await calls_views._admit_group_call(
            {"call_id": call_id, "chat_id": chat_id},
            from_user_id=owner.id,
            to_user_id=member.id,
        )
        assert ok
    assert len(_group_call_peers(call_id)) == MAX_GROUP_CALL_PARTICIPANTS

    # Пятый участник ЧАТА (он в группе, но места нет) — уже нельзя.
    extra = members[MAX_GROUP_CALL_PARTICIPANTS - 1]
    ok, reason = await calls_views._admit_group_call(
        {"call_id": call_id, "chat_id": chat_id},
        from_user_id=owner.id,
        to_user_id=extra.id,
    )
    assert (ok, reason) == (False, "full")
    assert extra.id not in _group_call_peers(call_id)


@needs_db
async def test_leaving_frees_a_slot(group_call: dict) -> None:
    """Вышедший освобождает место: следующий участник проходит."""
    owner = group_call["owner"]
    members = group_call["members"]
    chat_id = group_call["chat"]["id"]
    call_id = "call-freed"

    for member in members[: MAX_GROUP_CALL_PARTICIPANTS - 1]:
        await calls_views._admit_group_call(
            {"call_id": call_id, "chat_id": chat_id},
            from_user_id=owner.id,
            to_user_id=member.id,
        )
    calls_views._leave_group_call({"call_id": call_id}, members[0].id)

    ok, reason = await calls_views._admit_group_call(
        {"call_id": call_id, "chat_id": chat_id},
        from_user_id=owner.id,
        to_user_id=members[0].id,
    )
    assert (ok, reason) == (True, "")


@needs_db
async def test_last_participant_clears_the_call(group_call: dict) -> None:
    """Когда уходят все, реестр звонка пуст (в памяти не остаётся мусора)."""
    owner = group_call["owner"]
    member = group_call["members"][0]
    call_id = "call-clear"
    await calls_views._admit_group_call(
        {"call_id": call_id, "chat_id": group_call["chat"]["id"]},
        from_user_id=owner.id,
        to_user_id=member.id,
    )
    calls_views._leave_group_call({"call_id": call_id}, owner.id)
    calls_views._leave_group_call({"call_id": call_id}, member.id)
    assert call_id not in _group_calls


async def test_drop_removes_ringing_participant(group_call: dict) -> None:
    """Сброс убирает того, кто не поднял трубку, из состава звонка.

    Сервер обязан сделать это сам: сообщение `call-drop` адресовано ЕМУ, и если
    бы мы обрабатывали его как обычное «завершение от отправителя», из звонка
    вылетал бы инициатор, а неответивший продолжал бы «звонить».
    """
    owner = group_call["owner"]
    members = group_call["members"]
    chat_id = group_call["chat"]["id"]
    call_id = "call-drop"

    await calls_views._admit_group_call(
        {"call_id": call_id, "chat_id": chat_id},
        from_user_id=owner.id,
        to_user_id=members[0].id,
    )
    await calls_views._admit_group_call(
        {"call_id": call_id, "chat_id": chat_id},
        from_user_id=owner.id,
        to_user_id=members[1].id,
    )
    assert set(_group_call_peers(call_id)) == {owner.id, members[0].id, members[1].id}

    # Инициатор сбрасывает того, кто не ответил.
    calls_views._leave_group_call({"call_id": call_id}, members[1].id)
    assert members[1].id not in _group_call_peers(call_id)
    # Инициатор и ответивший остаются: разговор продолжается.
    assert set(_group_call_peers(call_id)) == {owner.id, members[0].id}


def test_drop_is_in_relay_whitelist() -> None:
    """`call-drop` пересылается: иначе кнопка «сбросить» молча ничего не делает."""
    assert "call-drop" in calls_views.RELAY_MESSAGE_TYPES
