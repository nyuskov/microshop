"""Обёртки ключа чата на устройства (E2EE, A5 — клиентская половина).

Ключ устройства у аккаунта теперь не один (`device_keys`), но личный чат всё ещё
шифровался ключом из общего секрета ДВУХ «текущих» ключей. Второе устройство с
другим приватным ключом такие сообщения прочитать не могло.

Здесь проверяем серверную половину решения: обёртки ключа чата хранятся по
устройствам (`/keys/chat/{chat_id}/`), раздать их может любой участник чата, а
раздающий обязан представиться своим устройством — иначе получатель не знает, с
чьим публичным ключом повторять ECDH. Обёртки для незарегистрированных устройств
не сохраняются: открыть их некому.
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy import select

from core.models import ChatDeviceKey
from tests.test_messenger_api import _ApiCtx  # noqa: E402
from tests.test_messenger_api import api as api_fixture  # noqa: E402

api = api_fixture

needs_db = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


async def _register_device(api: _ApiCtx, headers: dict, device_id: str) -> None:
    response = await api.client.put(
        "/api/v1/keys/me/",
        json={"public_key": f"JWK-{device_id}", "device_id": device_id},
        headers=headers,
    )
    assert response.status_code == 200, response.text


async def _put_keys(
    api: _ApiCtx,
    headers: dict,
    chat_id: int,
    entries: list[dict],
    *,
    sender_device_id: str = "phone",
    replace: bool = False,
):
    return await api.client.put(
        f"/api/v1/keys/chat/{chat_id}/",
        json={
            "keys": entries,
            "replace": replace,
            "sender_device_id": sender_device_id,
        },
        headers=headers,
    )


async def _get_keys(api: _ApiCtx, headers: dict, chat_id: int, device_id: str):
    return await api.client.get(
        f"/api/v1/keys/chat/{chat_id}/",
        params={"device_id": device_id},
        headers=headers,
    )


@needs_db
async def test_key_is_stored_per_recipient_device(api: _ApiCtx) -> None:
    """Ключ чата раскладывается по обёрткам на КАЖДОЕ устройство получателя."""
    alice = await api.make_user()
    bob = await api.make_user()
    alice_headers = api.auth(await api.token_for(alice))
    bob_headers = api.auth(await api.token_for(bob))
    chat = await api.private_chat(alice_headers["Authorization"].split()[1], bob.id)

    await _register_device(api, alice_headers, "alice-phone")
    await _register_device(api, bob_headers, "bob-phone")
    await _register_device(api, bob_headers, "bob-laptop")

    response = await _put_keys(
        api,
        alice_headers,
        chat["id"],
        [
            {"user_id": alice.id, "device_id": "alice-phone", "wrapped_key": "W-A1"},
            {"user_id": bob.id, "device_id": "bob-phone", "wrapped_key": "W-B1"},
            {"user_id": bob.id, "device_id": "bob-laptop", "wrapped_key": "W-B2"},
        ],
        sender_device_id="alice-phone",
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"count": 3}

    # Оба устройства Боба видят СВОЮ обёртку: телефон — одну, ноутбук — другую.
    phone = (await _get_keys(api, bob_headers, chat["id"], "bob-phone")).json()
    assert phone["has_key"] is True
    assert phone["wrapped_key"] == "W-B1"
    assert phone["wrapped_by_user_id"] == alice.id
    assert phone["wrapped_by_device_id"] == "alice-phone"

    laptop = (await _get_keys(api, bob_headers, chat["id"], "bob-laptop")).json()
    assert laptop["wrapped_key"] == "W-B2"


@needs_db
async def test_unknown_device_is_not_stored(api: _ApiCtx) -> None:
    """Обёртка для незарегистрированного устройства не сохраняется."""
    alice = await api.make_user()
    bob = await api.make_user()
    alice_token = await api.token_for(alice)
    bob_token = await api.token_for(bob)
    alice_headers = api.auth(alice_token)
    chat = await api.private_chat(alice_token, bob.id)

    await _register_device(api, alice_headers, "alice-phone")
    await _register_device(api, api.auth(bob_token), "bob-phone")

    response = await _put_keys(
        api,
        alice_headers,
        chat["id"],
        [
            {"user_id": bob.id, "device_id": "bob-phone", "wrapped_key": "W-B1"},
            # Устройства с таким id у Боба нет: открыть обёртку некому.
            {"user_id": bob.id, "device_id": "bob-tablet", "wrapped_key": "W-B2"},
        ],
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"count": 1}

    async with api.factory() as session:
        rows = (
            (
                await session.execute(
                    select(ChatDeviceKey).where(ChatDeviceKey.chat_id == chat["id"])
                )
            )
            .scalars()
            .all()
        )
    assert [row.device_id for row in rows] == ["bob-phone"]


@needs_db
async def test_no_known_devices_is_rejected(api: _ApiCtx) -> None:
    """Если ни одно устройство не зарегистрировано — 400, ничего не пишем."""
    alice = await api.make_user()
    bob = await api.make_user()
    alice_token = await api.token_for(alice)
    alice_headers = api.auth(alice_token)
    chat = await api.private_chat(alice_token, bob.id)

    response = await _put_keys(
        api,
        alice_headers,
        chat["id"],
        [{"user_id": bob.id, "device_id": "bob-phone", "wrapped_key": "W-B1"}],
    )
    assert response.status_code == 400
    assert "не зарегистрировано" in response.json()["detail"]


@needs_db
async def test_outsider_cannot_read_or_write_keys(api: _ApiCtx) -> None:
    """Чужой чат не виден: ни свою обёртку не получить, ни раздать нельзя."""
    alice = await api.make_user()
    bob = await api.make_user()
    mallory = await api.make_user()
    alice_token = await api.token_for(alice)
    mallory_headers = api.auth(await api.token_for(mallory))
    chat = await api.private_chat(alice_token, bob.id)
    await _register_device(api, mallory_headers, "mallory-phone")

    assert (
        await _get_keys(api, mallory_headers, chat["id"], "mallory-phone")
    ).status_code == 404
    outsider_put = await _put_keys(
        api,
        mallory_headers,
        chat["id"],
        [{"user_id": mallory.id, "device_id": "mallory-phone", "wrapped_key": "X"}],
    )
    assert outsider_put.status_code == 404


@needs_db
async def test_non_member_target_is_rejected(api: _ApiCtx) -> None:
    """Раздать ключ постороннему нельзя — 400."""
    alice = await api.make_user()
    bob = await api.make_user()
    mallory = await api.make_user()
    alice_token = await api.token_for(alice)
    alice_headers = api.auth(alice_token)
    chat = await api.private_chat(alice_token, bob.id)

    await _register_device(api, alice_headers, "alice-phone")
    await _register_device(api, api.auth(await api.token_for(mallory)), "mallory-phone")

    response = await _put_keys(
        api,
        alice_headers,
        chat["id"],
        [{"user_id": mallory.id, "device_id": "mallory-phone", "wrapped_key": "X"}],
    )
    assert response.status_code == 400
    assert "участникам" in response.json()["detail"]


@needs_db
async def test_replace_rewrites_rotated_key(api: _ApiCtx) -> None:
    """Ротация (`replace=true`) заменяет прежние обёртки новыми."""
    alice = await api.make_user()
    bob = await api.make_user()
    alice_token = await api.token_for(alice)
    bob_token = await api.token_for(bob)
    alice_headers = api.auth(alice_token)
    bob_headers = api.auth(bob_token)
    chat = await api.private_chat(alice_token, bob.id)
    await _register_device(api, alice_headers, "alice-phone")
    await _register_device(api, bob_headers, "bob-phone")

    await _put_keys(
        api,
        alice_headers,
        chat["id"],
        [{"user_id": bob.id, "device_id": "bob-phone", "wrapped_key": "OLD"}],
    )
    # Второе устройство Боба пропало из раздачи? Нет: replace переписывает всё,
    # поэтому новую обёртку надо дать и ему — обёртки стали новым ключом.
    await _register_device(api, bob_headers, "bob-laptop")
    response = await _put_keys(
        api,
        bob_headers,
        chat["id"],
        [
            {"user_id": alice.id, "device_id": "alice-phone", "wrapped_key": "NEW-A"},
            {"user_id": bob.id, "device_id": "bob-phone", "wrapped_key": "NEW-B1"},
            {"user_id": bob.id, "device_id": "bob-laptop", "wrapped_key": "NEW-B2"},
        ],
        sender_device_id="bob-phone",
        replace=True,
    )
    assert response.status_code == 200, response.text

    phone = (await _get_keys(api, bob_headers, chat["id"], "bob-phone")).json()
    assert phone["wrapped_key"] == "NEW-B1"
    assert phone["wrapped_by_device_id"] == "bob-phone"
    alice_phone = (
        await _get_keys(api, alice_headers, chat["id"], "alice-phone")
    ).json()
    assert alice_phone["wrapped_key"] == "NEW-A"
    # Прежних обёрток старого ключа не осталось.
    assert alice_phone["wrapped_by_user_id"] == bob.id


@needs_db
async def test_legacy_device_still_gets_wrapper(api: _ApiCtx) -> None:
    """Устройство старого клиента (`legacy`) тоже может получить обёртку."""
    alice = await api.make_user()
    bob = await api.make_user()
    alice_token = await api.token_for(alice)
    bob_token = await api.token_for(bob)
    alice_headers = api.auth(alice_token)
    bob_headers = api.auth(bob_token)
    chat = await api.private_chat(alice_token, bob.id)

    # Ключ старого клиента: device_id не присылается — сервер пишет `legacy`.
    assert (
        await api.client.put(
            "/api/v1/keys/me/",
            json={"public_key": "JWK-legacy"},
            headers=bob_headers,
        )
    ).status_code == 200
    await _register_device(api, alice_headers, "alice-phone")

    response = await _put_keys(
        api,
        alice_headers,
        chat["id"],
        [{"user_id": bob.id, "device_id": "legacy", "wrapped_key": "W-L"}],
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"count": 1}

    legacy = (await _get_keys(api, bob_headers, chat["id"], "legacy")).json()
    assert legacy["has_key"] is True
    assert legacy["wrapped_key"] == "W-L"


@needs_db
async def test_missing_wrapper_is_reported_as_no_key(api: _ApiCtx) -> None:
    """Пока обёртки нет — `has_key=false`, а не 404: клиент раздаст ключ сам."""
    alice = await api.make_user()
    bob = await api.make_user()
    alice_token = await api.token_for(alice)
    bob_headers = api.auth(await api.token_for(bob))
    chat = await api.private_chat(alice_token, bob.id)

    response = await _get_keys(api, bob_headers, chat["id"], "bob-phone")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "chat_id": chat["id"],
        "device_id": "bob-phone",
        "has_key": False,
        "wrapped_key": None,
        "wrapped_by_user_id": None,
        "wrapped_by_device_id": None,
    }
