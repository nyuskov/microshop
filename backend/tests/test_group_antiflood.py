"""Анти-флуд в группах: мут участника, бан-лист и медленный режим (нужен PostgreSQL).

Флуд в группе останавливать было нечем: исключённый возвращался по той же
ссылке, а писать можно было сколько угодно. Здесь проверяем три ограничения и
главное — что они применяются на ВСЕХ путях отправки (текст, вложение,
пересылка), иначе ограничение обходится «отправить картинкой». Плюс правила
ролей: админ не ограничивает админа, создателя не ограничивает никто, себя —
тоже.
"""

from __future__ import annotations

import os

import pytest

from tests.api_support import _ApiCtx  # noqa: E402
from tests.api_support import api as api_fixture  # noqa: E402
from tests.test_group_invites import _create_invite, _group, _join

api = api_fixture

needs_db = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


async def _mute(
    api: _ApiCtx, token: str, chat_id: int, user_id: int, minutes: int | None
):
    return await api.client.post(
        f"/api/v1/chats/{chat_id}/members/{user_id}/mute/",
        json={"minutes": minutes},
        headers=api.auth(token),
    )


async def _ban(api: _ApiCtx, token: str, chat_id: int, user_id: int, reason=None):
    return await api.client.post(
        f"/api/v1/chats/{chat_id}/members/{user_id}/ban/",
        json={"reason": reason},
        headers=api.auth(token),
    )


async def _slow_mode(api: _ApiCtx, token: str, chat_id: int, seconds: int):
    return await api.client.patch(
        f"/api/v1/chats/{chat_id}/slow-mode/",
        json={"seconds": seconds},
        headers=api.auth(token),
    )


@needs_db
async def test_muted_member_cannot_write(api: _ApiCtx) -> None:
    """Мут закрывает отправку, снятие мута возвращает возможность писать."""
    creator = await api.make_user()
    member = await api.make_user()
    creator_token = await api.token_for(creator)
    member_token = await api.token_for(member)
    chat = await _group(api, creator_token, [member.id])

    assert (await api.send(member_token, chat["id"], "до мута"))["text"] == "до мута"
    before_mute = await api.send(member_token, chat["id"], "это перешлём")

    muted = await _mute(api, creator_token, chat["id"], member.id, 60)
    assert muted.status_code == 200, muted.text
    # Карточка в ответе — с мутом: клиенту не нужен отдельный запрос.
    muted_member = next(m for m in muted.json()["members"] if m["id"] == member.id)
    assert muted_member["muted_until"] is not None

    blocked = await api.client.post(
        "/api/v1/messages/",
        json={"chat_id": chat["id"], "text": "в муте"},
        headers=api.auth(member_token),
    )
    assert blocked.status_code == 403
    assert "муте" in blocked.json()["detail"]

    # Вложение и пересылка — те же правила: иначе мут обходится «картинкой».
    upload = await api.client.post(
        f"/api/v1/messages/attachment/?chat_id={chat['id']}&filename=kartinka.png",
        content=b"\x89PNG\r\n\x1a\n" + b"0" * 64,
        headers={**api.auth(member_token), "Content-Type": "image/png"},
    )
    assert upload.status_code == 403

    forwarded = await api.client.post(
        "/api/v1/messages/forward/",
        json={"message_id": before_mute["id"], "chat_id": chat["id"]},
        headers=api.auth(member_token),
    )
    assert forwarded.status_code == 403

    # Снятие мута (minutes=None) — снова можно писать.
    cleared = await _mute(api, creator_token, chat["id"], member.id, None)
    assert cleared.status_code == 200, cleared.text
    assert (await api.send(member_token, chat["id"], "после мута"))[
        "text"
    ] == "после мута"


@needs_db
async def test_mute_spares_admins(api: _ApiCtx) -> None:
    """Админов и создателя мут не ограничивает, а другого админа не замутить."""
    creator = await api.make_user()
    admin = await api.make_user()
    member = await api.make_user()
    creator_token = await api.token_for(creator)
    admin_token = await api.token_for(admin)
    member_token = await api.token_for(member)
    chat = await _group(api, creator_token, [admin.id, member.id])

    promoted = await api.client.patch(
        f"/api/v1/chats/{chat['id']}/members/{admin.id}/role/",
        json={"role": "admin"},
        headers=api.auth(creator_token),
    )
    assert promoted.status_code == 204, promoted.text

    # Админ не может ограничить другого админа — и уж тем более создателя.
    assert (
        await _mute(api, admin_token, chat["id"], creator.id, 60)
    ).status_code == 400
    assert (await _mute(api, admin_token, chat["id"], admin.id, 60)).status_code == 400

    # Мут, поставленный админом обычному участнику, действует.
    assert (await _mute(api, admin_token, chat["id"], member.id, 5)).status_code == 200
    blocked = await api.client.post(
        "/api/v1/messages/",
        json={"chat_id": chat["id"], "text": "мне нельзя"},
        headers=api.auth(member_token),
    )
    assert blocked.status_code == 403

    # Обычный участник не может мутить никого.
    assert (await _mute(api, member_token, chat["id"], admin.id, 60)).status_code == 403


@needs_db
async def test_slow_mode_waits_for_pause(api: _ApiCtx) -> None:
    """Медленный режим: второе сообщение подряд — 429 с Retry-After, у админов — нет."""
    creator = await api.make_user()
    member = await api.make_user()
    creator_token = await api.token_for(creator)
    member_token = await api.token_for(member)
    chat = await _group(api, creator_token, [member.id])

    enabled = await _slow_mode(api, creator_token, chat["id"], 60)
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["slow_mode_seconds"] == 60

    assert (await api.send(member_token, chat["id"], "первое"))["text"] == "первое"
    second = await api.client.post(
        "/api/v1/messages/",
        json={"chat_id": chat["id"], "text": "второе"},
        headers=api.auth(member_token),
    )
    assert second.status_code == 429
    assert "Медленный режим" in second.json()["detail"]
    assert second.headers.get("retry-after") is not None

    # Создателя режим не ограничивает: правила ставят админы.
    assert (await api.send(creator_token, chat["id"], "админ пишет"))[
        "text"
    ] == "админ пишет"

    # Выключение режима — пауза больше не нужна.
    assert (await _slow_mode(api, creator_token, chat["id"], 0)).status_code == 200
    assert (await api.send(member_token, chat["id"], "сразу после"))[
        "text"
    ] == "сразу после"

    # Настройку меняют только админы.
    assert (await _slow_mode(api, member_token, chat["id"], 5)).status_code == 403


@needs_db
async def test_ban_kicks_and_closes_the_door(api: _ApiCtx) -> None:
    """Бан исключает участника и закрывает вход даже по ссылке; снятие — открывает."""
    creator = await api.make_user()
    member = await api.make_user()
    creator_token = await api.token_for(creator)
    member_token = await api.token_for(member)
    chat = await _group(api, creator_token, [member.id])
    invite = await _create_invite(api, creator_token, chat["id"])

    banned = await _ban(api, creator_token, chat["id"], member.id, "спам")
    assert banned.status_code == 200, banned.text
    assert all(m["id"] != member.id for m in banned.json()["members"])

    # Исключён и не может вернуться по ссылке.
    own_chats = (
        await api.client.get("/api/v1/chats/", headers=api.auth(member_token))
    ).json()
    assert all(c["id"] != chat["id"] for c in own_chats)
    blocked_join = await _join(api, member_token, invite["token"])
    assert blocked_join.status_code == 403
    assert "забанены" in blocked_join.json()["detail"]

    # Добавить обратно вручную тоже нельзя — сначала снять бан.
    re_add = await api.client.post(
        f"/api/v1/chats/{chat['id']}/members/",
        json={"user_ids": [member.id]},
        headers=api.auth(creator_token),
    )
    assert re_add.status_code == 403

    # Бан-лист виден админам; обычному участнику — нет.
    other = await api.make_user()
    other_token = await api.token_for(other)
    assert (
        await api.client.get(
            f"/api/v1/chats/{chat['id']}/bans/", headers=api.auth(other_token)
        )
    ).status_code == 403

    bans = (
        await api.client.get(
            f"/api/v1/chats/{chat['id']}/bans/", headers=api.auth(creator_token)
        )
    ).json()
    assert [b["user_id"] for b in bans] == [member.id]
    assert bans[0]["reason"] == "спам"

    # Снятие бана открывает вход обратно (участником человек не становится).
    unbanned = await api.client.delete(
        f"/api/v1/chats/{chat['id']}/bans/{member.id}/",
        headers=api.auth(creator_token),
    )
    assert unbanned.status_code == 204
    assert (await _join(api, member_token, invite["token"])).status_code == 200


@needs_db
async def test_ban_and_mute_only_for_groups(api: _ApiCtx) -> None:
    """В личном чате мута и медленного режима нет: там свои правила."""
    first = await api.make_user()
    second = await api.make_user()
    first_token = await api.token_for(first)
    chat = await api.private_chat(first_token, second.id)

    # Личный чат — не группа: и мут, и медленный режим отсекает _ensure_group.
    muted = await _mute(api, first_token, chat["id"], second.id, 60)
    assert muted.status_code == 404
    assert muted.json()["detail"] == "Группа не найдена"

    slow = await _slow_mode(api, first_token, chat["id"], 30)
    assert slow.status_code == 404
