"""HTTP API-тесты каналов (нужен PostgreSQL).

Канал — чат с `is_channel=True`: публикуют владелец и админы, подписчики читают,
комментируют и предлагают посты на одобрение. Здесь проверяем весь контур:
создание и лимиты, публичный адрес и поиск, подписку/отписку, ограничение на
публикацию для подписчиков, комментарии со счётчиками, просмотры, назначение
админов и предложенные посты.

Запускаются только при заданном TEST_DATABASE_URL (в CI его даёт сервис postgres).
Обвязка (httpx-клиент + хелперы) переиспользуется из тестов мессенджера.
"""

from __future__ import annotations

import os

import pytest

# Фикстура `api` и её контекст живут в общей обвязке API-тестов: там уже поднят
# ASGI-клиент, подмена сессий и очистка таблиц между тестами.
from tests.api_support import _ApiCtx, api  # noqa: F401

pytestmark = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


async def _create_channel(api: _ApiCtx, token: str, **overrides) -> dict:
    payload = {
        "title": overrides.pop("title", "Мой канал"),
        "description": overrides.pop("description", "Описание"),
        "is_public": overrides.pop("is_public", False),
        **overrides,
    }
    response = await api.client.post(
        "/api/v1/channels/", json=payload, headers=api.auth(token)
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_create_channel_makes_owner_subscriber(api: _ApiCtx) -> None:
    """Создатель становится владельцем и первым подписчиком канала."""
    owner = await api.make_user()
    token = await api.token_for(owner)

    card = await _create_channel(api, token, title="Кулинария")

    assert card["title"] == "Кулинария"
    assert card["role"] == "creator"
    assert card["subscribers"] == 1
    assert card["posts"] == 0
    assert card["is_public"] is False


async def test_channel_limit_per_account(api: _ApiCtx) -> None:
    """На аккаунт — не больше 10 каналов."""
    owner = await api.make_user()
    token = await api.token_for(owner)

    for index in range(10):
        await _create_channel(api, token, title=f"Канал {index}")

    response = await api.client.post(
        "/api/v1/channels/", json={"title": "Лишний"}, headers=api.auth(token)
    )
    assert response.status_code == 409, response.text


async def test_public_channel_alias_and_search(api: _ApiCtx) -> None:
    """Публичный канал: адрес уникален, находится в поиске и по ссылке."""
    owner = await api.make_user()
    other = await api.make_user()
    token, other_token = await api.token_for(owner), await api.token_for(other)

    card = await _create_channel(
        api, token, title="Новости", is_public=True, username="PismoNews"
    )
    # Адрес нормализуется (нижний регистр).
    assert card["username"] == "pismonews"
    assert card["is_public"] is True

    # Занятый адрес — конфликт.
    conflict = await api.client.post(
        "/api/v1/channels/",
        json={"title": "Другой", "is_public": True, "username": "pismonews"},
        headers=api.auth(other_token),
    )
    assert conflict.status_code == 409, conflict.text

    # Невалидный адрес — 422.
    bad = await api.client.post(
        "/api/v1/channels/",
        json={"title": "Плохой", "is_public": True, "username": "1"},
        headers=api.auth(other_token),
    )
    assert bad.status_code == 422, bad.text

    # Поиск по адресу и по названию.
    by_alias = (
        await api.client.get(
            "/api/v1/channels/search/",
            params={"q": "@pismonews"},
            headers=api.auth(other_token),
        )
    ).json()
    assert [item["id"] for item in by_alias] == [card["id"]]

    by_title = (
        await api.client.get(
            "/api/v1/channels/search/",
            params={"q": "новости"},
            headers=api.auth(other_token),
        )
    ).json()
    assert card["id"] in [item["id"] for item in by_title]

    # Ссылка /c/<username> отдаёт карточку для экрана подписки.
    preview = await api.client.get(
        "/api/v1/channels/by-username/pismonews/", headers=api.auth(other_token)
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["role"] is None


async def test_private_channel_join_requires_invite(api: _ApiCtx) -> None:
    """Приватный канал: подписка только по ссылке-приглашению."""
    owner = await api.make_user()
    guest = await api.make_user()
    token, guest_token = await api.token_for(owner), await api.token_for(guest)
    card = await _create_channel(api, token, title="Закрытый")

    denied = await api.client.post(
        f"/api/v1/channels/{card['id']}/join/", headers=api.auth(guest_token)
    )
    assert denied.status_code == 403, denied.text

    # Владелец видит, что гость не подписан.
    assert card["role"] == "creator"


async def test_public_channel_join_and_leave(api: _ApiCtx) -> None:
    """Подписка идемпотентна, отписка убирает доступ к комментариям."""
    owner = await api.make_user()
    guest = await api.make_user()
    token, guest_token = await api.token_for(owner), await api.token_for(guest)
    card = await _create_channel(
        api, token, title="Открытый", is_public=True, username="openchan"
    )

    joined = await api.client.post(
        f"/api/v1/channels/{card['id']}/join/", headers=api.auth(guest_token)
    )
    assert joined.status_code == 200, joined.text
    assert joined.json()["role"] == "member"
    assert joined.json()["subscribers"] == 2

    again = await api.client.post(
        f"/api/v1/channels/{card['id']}/join/", headers=api.auth(guest_token)
    )
    assert again.json()["subscribers"] == 2

    post = await api.send(token, card["id"], "Первый пост")
    await api.client.post(
        f"/api/v1/channels/{card['id']}/posts/{post['id']}/comments/",
        json={"text": "Комментарий"},
        headers=api.auth(guest_token),
    )

    left = await api.client.post(
        f"/api/v1/channels/{card['id']}/leave/", headers=api.auth(guest_token)
    )
    assert left.status_code == 204, left.text

    after = await api.client.post(
        f"/api/v1/channels/{card['id']}/posts/{post['id']}/comments/",
        json={"text": "Ещё"},
        headers=api.auth(guest_token),
    )
    assert after.status_code == 403, after.text

    # Владелец отписаться не может — он удаляет канал.
    owner_leave = await api.client.post(
        f"/api/v1/channels/{card['id']}/leave/", headers=api.auth(token)
    )
    assert owner_leave.status_code == 409, owner_leave.text


async def test_subscriber_cannot_post_but_owner_can(api: _ApiCtx) -> None:
    """В ленту канала пишут только владелец и админы."""
    owner = await api.make_user()
    guest = await api.make_user()
    token, guest_token = await api.token_for(owner), await api.token_for(guest)
    card = await _create_channel(
        api, token, title="Посты", is_public=True, username="postschan"
    )
    await api.client.post(
        f"/api/v1/channels/{card['id']}/join/", headers=api.auth(guest_token)
    )

    denied = await api.client.post(
        "/api/v1/messages/",
        json={"chat_id": card["id"], "text": "Я подписчик"},
        headers=api.auth(guest_token),
    )
    assert denied.status_code == 403, denied.text
    assert "предложить" in denied.text.lower()

    post = await api.send(token, card["id"], "Пост владельца")
    assert post["text"] == "Пост владельца"


async def test_comments_views_and_meta(api: _ApiCtx) -> None:
    """Комментарии под постом, счётчики и просмотры постов."""
    owner = await api.make_user()
    guest = await api.make_user()
    token, guest_token = await api.token_for(owner), await api.token_for(guest)
    card = await _create_channel(
        api, token, title="Обсуждения", is_public=True, username="discuss"
    )
    await api.client.post(
        f"/api/v1/channels/{card['id']}/join/", headers=api.auth(guest_token)
    )
    post = await api.send(token, card["id"], "Тема дня")
    base = f"/api/v1/channels/{card['id']}/posts/{post['id']}"

    comment = await api.client.post(
        f"{base}/comments/",
        json={"text": "Первый!"},
        headers=api.auth(guest_token),
    )
    assert comment.status_code == 201, comment.text
    assert comment.json()["user_id"] == guest.id

    listed = (await api.client.get(f"{base}/comments/", headers=api.auth(token))).json()
    assert [item["text"] for item in listed] == ["Первый!"]
    # Владелец канала может удалять чужие комментарии.
    assert listed[0]["can_delete"] is True

    # Просмотры: повторные открытия счётчик не накручивают.
    await api.client.post(f"{base}/view/", headers=api.auth(guest_token))
    await api.client.post(f"{base}/view/", headers=api.auth(guest_token))
    meta = (
        await api.client.get(
            f"/api/v1/channels/{card['id']}/posts/meta/",
            params={"ids": str(post["id"])},
            headers=api.auth(token),
        )
    ).json()
    assert meta == [{"message_id": post["id"], "views": 1, "comments": 1}]

    # Удаление чужого комментария подписчиком — запрещено (проверяет другой
    # подписчик: автор свой комментарий удалить может).
    another = await api.make_user()
    another_token = await api.token_for(another)
    await api.client.post(
        f"/api/v1/channels/{card['id']}/join/", headers=api.auth(another_token)
    )
    denied = await api.client.delete(
        f"/api/v1/channels/{card['id']}/comments/{comment.json()['id']}/",
        headers=api.auth(another_token),
    )
    assert denied.status_code == 403, denied.text

    # Свой комментарий удалить можно.
    own = await api.client.post(
        f"{base}/comments/", json={"text": "Удалю"}, headers=api.auth(guest_token)
    )
    removed = await api.client.delete(
        f"/api/v1/channels/{card['id']}/comments/{own.json()['id']}/",
        headers=api.auth(guest_token),
    )
    assert removed.status_code == 204, removed.text


async def test_admins_can_post_and_manage(api: _ApiCtx) -> None:
    """Владелец назначает админа — тот получает право публиковать."""
    owner = await api.make_user()
    helper = await api.make_user()
    token, helper_token = await api.token_for(owner), await api.token_for(helper)
    card = await _create_channel(
        api, token, title="Команда", is_public=True, username="teamchan"
    )
    await api.client.post(
        f"/api/v1/channels/{card['id']}/join/", headers=api.auth(helper_token)
    )

    # Не владелец назначить админа не может.
    denied = await api.client.post(
        f"/api/v1/channels/{card['id']}/admins/",
        json={"user_id": helper.id, "admin": True},
        headers=api.auth(helper_token),
    )
    assert denied.status_code == 403, denied.text

    promoted = await api.client.post(
        f"/api/v1/channels/{card['id']}/admins/",
        json={"user_id": helper.id, "admin": True},
        headers=api.auth(token),
    )
    assert promoted.status_code == 204, promoted.text

    subscribers = (
        await api.client.get(
            f"/api/v1/channels/{card['id']}/subscribers/", headers=api.auth(token)
        )
    ).json()
    roles = {item["id"]: item["role"] for item in subscribers}
    assert roles[helper.id] == "admin"

    # Теперь админ может публиковать в ленту канала.
    post = await api.send(helper_token, card["id"], "Пост админа")
    assert post["text"] == "Пост админа"


async def test_suggested_posts_flow(api: _ApiCtx) -> None:
    """Подписчик предлагает пост: админ одобряет или отклоняет."""
    owner = await api.make_user()
    guest = await api.make_user()
    token, guest_token = await api.token_for(owner), await api.token_for(guest)
    card = await _create_channel(
        api, token, title="Предложки", is_public=True, username="suggest"
    )
    await api.client.post(
        f"/api/v1/channels/{card['id']}/join/", headers=api.auth(guest_token)
    )

    first = await api.client.post(
        f"/api/v1/channels/{card['id']}/suggestions/",
        json={"text": "Предложенный пост"},
        headers=api.auth(guest_token),
    )
    assert first.status_code == 201, first.text
    suggestion_id = first.json()["id"]

    pending = (
        await api.client.get(
            f"/api/v1/channels/{card['id']}/suggestions/", headers=api.auth(token)
        )
    ).json()
    assert [item["id"] for item in pending] == [suggestion_id]

    approved = await api.client.post(
        f"/api/v1/channels/{card['id']}/suggestions/{suggestion_id}/approve/",
        headers=api.auth(token),
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    message_id = approved.json()["message_id"]
    assert isinstance(message_id, int)

    # Пост действительно появился в ленте канала.
    messages = await api.list_messages(token, card["id"])
    assert message_id in [item["id"] for item in messages]

    # Повторное рассмотрение — конфликт.
    again = await api.client.post(
        f"/api/v1/channels/{card['id']}/suggestions/{suggestion_id}/approve/",
        headers=api.auth(token),
    )
    assert again.status_code == 409, again.text

    # Отклонение: видно автору в его списке предложек.
    second = await api.client.post(
        f"/api/v1/channels/{card['id']}/suggestions/",
        json={"text": "Отклонят"},
        headers=api.auth(guest_token),
    )
    rejected = await api.client.post(
        f"/api/v1/channels/{card['id']}/suggestions/{second.json()['id']}/reject/",
        headers=api.auth(token),
    )
    assert rejected.json()["status"] == "rejected"

    mine = (
        await api.client.get(
            f"/api/v1/channels/{card['id']}/suggestions/",
            params={"only_pending": "false"},
            headers=api.auth(guest_token),
        )
    ).json()
    assert {item["status"] for item in mine} == {"approved", "rejected"}


async def test_channel_card_in_chat_list(api: _ApiCtx) -> None:
    """Канал виден в списке чатов с признаком канала и адресом."""
    owner = await api.make_user()
    guest = await api.make_user()
    token, guest_token = await api.token_for(owner), await api.token_for(guest)
    card = await _create_channel(
        api, token, title="В списке", is_public=True, username="inlist"
    )
    await api.client.post(
        f"/api/v1/channels/{card['id']}/join/", headers=api.auth(guest_token)
    )

    chats = (
        await api.client.get("/api/v1/chats/", headers=api.auth(guest_token))
    ).json()
    item = next(c for c in chats if c["id"] == card["id"])
    assert item["is_channel"] is True
    assert item["channel_username"] == "inlist"
    assert item["is_public"] is True
