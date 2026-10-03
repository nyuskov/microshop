"""Ключи E2EE: несколько устройств на один аккаунт (пункт A5 плана).

Раньше у пользователя был ОДИН публичный ключ (`device_keys.user_id` уникален).
Вход с телефона или из другого браузера заменял его, и вся прежняя переписка на
первом устройстве становилась нечитаемой — самая частая жалоба на такие схемы.

Здесь проверяем серверную половину: устройство идентифицируется парой
`(user_id, device_id)`, второй вход НЕ стирает первый ключ, а собеседник получает
список всех устройств (по ним клиент шифрует «обёртки» ключа чата).

Совместимость: старый клиент не присылает `device_id` — его ключ пишется в строку
`legacy`, и поля `public_key`/`changed_at` в ответе остаются как были.
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy import select

from core.models import DeviceKey
from tests.api_support import _ApiCtx  # noqa: E402
from tests.api_support import api as api_fixture  # noqa: E402

api = api_fixture

needs_db = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


async def _put(api: _ApiCtx, headers: dict, public_key: str, device_id: str | None):
    body: dict[str, str] = {"public_key": public_key}
    if device_id is not None:
        body["device_id"] = device_id
    response = await api.client.put("/api/v1/keys/me/", json=body, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


@needs_db
async def test_second_device_does_not_erase_first(api: _ApiCtx) -> None:
    """Новый вход добавляет ключ устройства, а не заменяет прежний."""
    user = await api.make_user()
    headers = api.auth(await api.token_for(user))

    assert await _put(api, headers, "JWK-phone", "phone") == {
        "ok": True,
        "changed": False,
    }
    # Второе устройство: раньше это стирало ключ телефона, и старая переписка
    # на нём становилась нечитаемой.
    await _put(api, headers, "JWK-laptop", "laptop")

    async with api.factory() as session:
        rows = (
            (
                await session.execute(
                    select(DeviceKey)
                    .where(DeviceKey.user_id == user.id)
                    .order_by(DeviceKey.device_id)
                )
            )
            .scalars()
            .all()
        )
    assert [(row.device_id, row.public_key) for row in rows] == [
        ("laptop", "JWK-laptop"),
        ("phone", "JWK-phone"),
    ]


@needs_db
async def test_repeat_upload_updates_own_device_only(api: _ApiCtx) -> None:
    """Повторная загрузка тем же устройством обновляет его строку, не плодя дубли."""
    user = await api.make_user()
    headers = api.auth(await api.token_for(user))

    await _put(api, headers, "JWK-1", "phone")
    again = await _put(api, headers, "JWK-1", "phone")
    assert again == {"ok": True, "changed": False}

    changed = await _put(api, headers, "JWK-2", "phone")
    # Смена ключа внутри устройства — по-прежнему событие безопасности.
    assert changed == {"ok": True, "changed": True}

    async with api.factory() as session:
        rows = (
            (
                await session.execute(
                    select(DeviceKey).where(DeviceKey.user_id == user.id)
                )
            )
            .scalars()
            .all()
        )
    assert len(rows) == 1
    assert rows[0].public_key == "JWK-2"


@needs_db
async def test_key_endpoint_lists_all_devices(api: _ApiCtx) -> None:
    """Собеседник получает список устройств (для обёрток) и «основной» ключ.

    `public_key` остаётся ради совместимости: старый клиент шифрует только на
    него, и это должен быть самый свежий ключ.
    """
    user = await api.make_user()
    peer = await api.make_user()
    headers = api.auth(await api.token_for(user))

    await _put(api, headers, "JWK-old", "tablet")
    await _put(api, headers, "JWK-new", "phone")

    response = await api.client.get(
        f"/api/v1/keys/{user.id}/", headers=api.auth(await api.token_for(peer))
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["has_key"] is True
    assert {item["device_id"] for item in body["devices"]} == {"tablet", "phone"}
    # Основной — самый свежий по времени обновления.
    assert body["public_key"] == "JWK-new"
    assert all(item["changed_at"] for item in body["devices"])


@needs_db
async def test_legacy_client_keeps_working(api: _ApiCtx) -> None:
    """Старый клиент без `device_id` пишет ключ в строку `legacy`."""
    user = await api.make_user()
    peer = await api.make_user()
    headers = api.auth(await api.token_for(user))

    await _put(api, headers, "JWK-legacy", None)

    async with api.factory() as session:
        row = (
            await session.execute(select(DeviceKey).where(DeviceKey.user_id == user.id))
        ).scalar_one()
    assert row.device_id == "legacy"

    body = (
        await api.client.get(
            f"/api/v1/keys/{user.id}/", headers=api.auth(await api.token_for(peer))
        )
    ).json()
    assert body["public_key"] == "JWK-legacy"
    assert [item["device_id"] for item in body["devices"]] == ["legacy"]


@needs_db
async def test_missing_key_reports_no_devices(api: _ApiCtx) -> None:
    """Без ключей — `has_key: false` и пустой список (клиент покажет заглушку)."""
    user = await api.make_user()
    peer = await api.make_user()
    response = await api.client.get(
        f"/api/v1/keys/{user.id}/", headers=api.auth(await api.token_for(peer))
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_key"] is False
    assert body["devices"] == []
