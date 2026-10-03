"""Ссылки-приглашения в группы (нужен PostgreSQL).

Ссылка — способ позвать в группу без ручного добавления: создатель или админ
делает её в карточке группы, отправляет другу, тот открывает и присоединяется.
Проверяем правила и ограничения: кто может создавать, что видит приглашённый,
вход по ссылке (в том числе повторный), срок годности, лимит входов, отзыв и
запрет входа в зашифрованную группу (там ключ выдаёт участник, а не сервер).
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import update

from tests.api_support import _ApiCtx  # noqa: E402
from tests.api_support import api as api_fixture  # noqa: E402

api = api_fixture

needs_db = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


async def _group(api: _ApiCtx, token: str, members: list[int] | None = None) -> dict:
    """Создаёт группу: API требует хотя бы одного участника, кроме создателя."""
    user_ids = list(members or [])
    if not user_ids:
        filler = await api.make_user()
        user_ids = [filler.id]
    response = await api.client.post(
        "/api/v1/chats/groups/",
        json={"name": f"Группа {uuid.uuid4().hex[:6]}", "user_ids": user_ids},
        headers=api.auth(token),
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _create_invite(api: _ApiCtx, token: str, chat_id: int, **body) -> dict:
    response = await api.client.post(
        f"/api/v1/chats/{chat_id}/invites/", json=body, headers=api.auth(token)
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _join(api: _ApiCtx, token: str, invite_token: str):
    return await api.client.post(
        f"/api/v1/chats/invites/{invite_token}/join/", headers=api.auth(token)
    )


@needs_db
async def test_creator_makes_invite_and_outsider_joins(api: _ApiCtx) -> None:
    """Создатель делает ссылку, посторонний по ней входит в группу."""
    creator = await api.make_user()
    member = await api.make_user()
    outsider = await api.make_user()
    creator_token = await api.token_for(creator)
    outsider_token = await api.token_for(outsider)
    chat = await _group(api, creator_token, [member.id])

    invite = await _create_invite(api, creator_token, chat["id"])
    assert invite["path"] == f"/j/{invite['token']}"
    assert invite["active"] is True
    assert invite["uses"] == 0

    # Приглашённый видит карточку группы до вступления.
    preview = await api.client.get(
        f"/api/v1/chats/invites/{invite['token']}/", headers=api.auth(outsider_token)
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["chat_id"] == chat["id"]
    assert body["name"] == chat["name"]
    assert body["member_count"] == 2
    assert body["is_member"] is False

    joined = await _join(api, outsider_token, invite["token"])
    assert joined.status_code == 200, joined.text
    assert joined.json() == {"chat_id": chat["id"], "name": chat["name"]}

    # Группа появилась в списке чатов, состав вырос, лимит ссылки потрачен.
    chats = (
        await api.client.get("/api/v1/chats/", headers=api.auth(outsider_token))
    ).json()
    assert any(c["id"] == chat["id"] for c in chats)

    fresh = await api.client.get(
        f"/api/v1/chats/{chat['id']}/invites/", headers=api.auth(creator_token)
    )
    assert fresh.json()[0]["uses"] == 1


@needs_db
async def test_rejoin_by_same_link_is_idempotent(api: _ApiCtx) -> None:
    """Повторный вход по той же ссылке ничего не ломает и лимит не тратит."""
    creator = await api.make_user()
    outsider = await api.make_user()
    creator_token = await api.token_for(creator)
    outsider_token = await api.token_for(outsider)
    chat = await _group(api, creator_token)
    invite = await _create_invite(api, creator_token, chat["id"], max_uses=1)

    assert (await _join(api, outsider_token, invite["token"])).status_code == 200
    assert (await _join(api, outsider_token, invite["token"])).status_code == 200

    invites = (
        await api.client.get(
            f"/api/v1/chats/{chat['id']}/invites/", headers=api.auth(creator_token)
        )
    ).json()
    assert invites[0]["uses"] == 1


@needs_db
async def test_invite_only_for_admins(api: _ApiCtx) -> None:
    """Ссылку создаёт создатель или админ; обычный участник — нет."""
    creator = await api.make_user()
    member = await api.make_user()
    creator_token = await api.token_for(creator)
    member_token = await api.token_for(member)
    chat = await _group(api, creator_token, [member.id])

    denied = await api.client.post(
        f"/api/v1/chats/{chat['id']}/invites/", json={}, headers=api.auth(member_token)
    )
    assert denied.status_code == 403, denied.text

    # Назначаем админом — теперь можно.
    promoted = await api.client.patch(
        f"/api/v1/chats/{chat['id']}/members/{member.id}/role/",
        json={"role": "admin"},
        headers=api.auth(creator_token),
    )
    assert promoted.status_code == 204, promoted.text
    invite = await _create_invite(api, member_token, chat["id"])
    assert invite["token"]


@needs_db
async def test_invite_not_available_for_private_chat(api: _ApiCtx) -> None:
    """В личном чате ссылок-приглашений нет."""
    user = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(user)
    chat = await api.private_chat(token, peer.id)

    response = await api.client.post(
        f"/api/v1/chats/{chat['id']}/invites/", json={}, headers=api.auth(token)
    )
    assert response.status_code == 404, response.text


@needs_db
async def test_revoked_and_unknown_links_do_not_work(api: _ApiCtx) -> None:
    """Отозванная ссылка сразу перестаёт пускать, несуществующая — не найдена."""
    creator = await api.make_user()
    outsider = await api.make_user()
    creator_token = await api.token_for(creator)
    outsider_token = await api.token_for(outsider)
    chat = await _group(api, creator_token)
    invite = await _create_invite(api, creator_token, chat["id"])

    revoked = await api.client.delete(
        f"/api/v1/chats/{chat['id']}/invites/{invite['id']}/",
        headers=api.auth(creator_token),
    )
    assert revoked.status_code == 204, revoked.text

    blocked = await _join(api, outsider_token, invite["token"])
    assert blocked.status_code == 410, blocked.text
    assert "не действует" in blocked.json()["detail"]

    unknown = await _join(api, outsider_token, "no-such-token")
    assert unknown.status_code == 404, unknown.text


@needs_db
async def test_expired_and_exhausted_links_do_not_work(api: _ApiCtx) -> None:
    """Ссылка с истёкшим сроком и исчерпанным лимитом входов не пускает."""
    creator = await api.make_user()
    first = await api.make_user()
    second = await api.make_user()
    creator_token = await api.token_for(creator)
    first_token = await api.token_for(first)
    second_token = await api.token_for(second)
    chat = await _group(api, creator_token)

    expiring = await _create_invite(api, creator_token, chat["id"], expires_in_hours=1)
    # Сдвигаем срок в прошлое (как будто час уже прошёл).
    async with api.factory() as session:
        from core.models import ChatInvite

        await session.execute(
            update(ChatInvite)
            .where(ChatInvite.id == expiring["id"])
            .values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
        )
        await session.commit()
    assert (await _join(api, first_token, expiring["token"])).status_code == 410

    single_use = await _create_invite(api, creator_token, chat["id"], max_uses=1)
    assert (await _join(api, first_token, single_use["token"])).status_code == 200
    exhausted = await _join(api, second_token, single_use["token"])
    assert exhausted.status_code == 410, exhausted.text


@needs_db
async def test_encrypted_group_cannot_be_joined_by_link(api: _ApiCtx) -> None:
    """В зашифрованную группу по ссылке войти нельзя — ключ выдаёт участник."""
    creator = await api.make_user()
    outsider = await api.make_user()
    creator_token = await api.token_for(creator)
    outsider_token = await api.token_for(outsider)
    chat = await _group(api, creator_token)

    enabled = await api.client.put(
        f"/api/v1/chats/{chat['id']}/e2ee/",
        json={"enabled": True},
        headers=api.auth(creator_token),
    )
    assert enabled.status_code == 200, enabled.text

    # Ссылку создать можно (её может выдать и админ зашифрованной группы)…
    invite = await _create_invite(api, creator_token, chat["id"])
    # …но вход по ней закрыт с понятным объяснением.
    response = await _join(api, outsider_token, invite["token"])
    assert response.status_code == 409, response.text
    assert "зашифрована" in response.json()["detail"]


@needs_db
async def test_invite_list_marks_inactive_first(api: _ApiCtx) -> None:
    """Список ссылок: действующие сверху, отозванные — ниже и с active=false."""
    creator = await api.make_user()
    token = await api.token_for(creator)
    chat = await _group(api, token)

    first = await _create_invite(api, token, chat["id"])
    second = await _create_invite(api, token, chat["id"])
    await api.client.delete(
        f"/api/v1/chats/{chat['id']}/invites/{second['id']}/", headers=api.auth(token)
    )

    listed = (
        await api.client.get(
            f"/api/v1/chats/{chat['id']}/invites/", headers=api.auth(token)
        )
    ).json()
    assert [item["id"] for item in listed] == [first["id"], second["id"]]
    assert [item["active"] for item in listed] == [True, False]


@needs_db
async def test_creator_rejoining_by_link_gets_creator_role(api: _ApiCtx) -> None:
    """Создатель, вернувшийся в группу по ссылке, снова создатель.

    Иначе группа осталась бы без владельца: ни звать по ссылке, ни менять
    название, ни назначать админов было бы некому.
    """
    creator = await api.make_user()
    member = await api.make_user()
    creator_token = await api.token_for(creator)
    chat = await _group(api, creator_token, [member.id])
    invite = await _create_invite(api, creator_token, chat["id"])

    # Через интерфейс создатель выйти не может, пока в группе есть участники —
    # сервер это запрещает (иначе группа осталась бы без владельца).
    left = await api.client.delete(
        f"/api/v1/chats/{chat['id']}/", headers=api.auth(creator_token)
    )
    assert left.status_code == 400, left.text

    # Убираем создателя из состава напрямую: такую ситуацию интерфейс не делает,
    # но контракт «создатель по ссылке возвращается создателем» держим.
    async with api.factory() as session:
        from core.models import user_chat_association_table

        await session.execute(
            user_chat_association_table.delete().where(
                user_chat_association_table.c.chat_id == chat["id"],
                user_chat_association_table.c.user_id == creator.id,
            )
        )
        await session.commit()

    joined = await _join(api, creator_token, invite["token"])
    assert joined.status_code == 200, joined.text

    detail = (
        await api.client.get(
            f"/api/v1/chats/{chat['id']}/", headers=api.auth(creator_token)
        )
    ).json()
    assert detail["my_role"] == "creator"
    # И права вернулись: ссылку можно создать снова.
    again = await _create_invite(api, creator_token, chat["id"])
    assert again["token"] != invite["token"]
