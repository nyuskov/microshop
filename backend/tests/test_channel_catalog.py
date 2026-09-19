"""Поиск в каталоге каналов (нужен PostgreSQL).

Экран каталога — новое использование уже существовавшего `GET /channels/search/`,
поэтому проверяем именно то, что легко сломать в запросе к БД: служебные символы
LIKE (% и _) не должны превращаться в шаблон, а канал с ТОЧНО таким адресом
обязан идти первым (человек ищет «@pismo», а не «всё, где встречается pismo»).
Приватные каналы и обычные чаты в выдачу не попадают.
"""

from __future__ import annotations

import os

import pytest
from test_channels_api import _create_channel  # noqa: E402
from test_messenger_api import _ApiCtx  # noqa: E402
from test_messenger_api import api as api_fixture  # noqa: E402

api = api_fixture

pytestmark = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


async def _search(api: _ApiCtx, token: str, query: str) -> list[dict]:
    response = await api.client.get(
        "/api/v1/channels/search/", params={"q": query}, headers=api.auth(token)
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_search_does_not_treat_wildcards_as_pattern(api: _ApiCtx) -> None:
    """«%» и «_» — обычные символы запроса, а не «показать всё»."""
    owner = await api.make_user()
    viewer = await api.make_user()
    token, viewer_token = await api.token_for(owner), await api.token_for(viewer)

    await _create_channel(
        api, token, title="Новости", is_public=True, username="newsone"
    )
    await _create_channel(
        api, token, title="Кулинария", is_public=True, username="cook"
    )

    # Раньше `%` подставлялся в LIKE как «любая строка» и находил ВСЕ каналы,
    # а `_` — всё, где в адресе есть хоть один символ.
    assert await _search(api, viewer_token, "%") == []
    assert await _search(api, viewer_token, "_") == []

    found = await _search(api, viewer_token, "news")
    assert [item["username"] for item in found] == ["newsone"]


async def test_search_finds_by_title_and_alias(api: _ApiCtx) -> None:
    """Поиск по названию — без учёта регистра, «@» в начале запроса не мешает."""
    owner = await api.make_user()
    viewer = await api.make_user()
    token, viewer_token = await api.token_for(owner), await api.token_for(viewer)
    card = await _create_channel(
        api, token, title="Пишем про птиц", is_public=True, username="birds"
    )

    by_title = await _search(api, viewer_token, "птиц")
    assert [item["id"] for item in by_title] == [card["id"]]

    # «@» в начале — привычная запись адреса, сервер её отбрасывает.
    by_alias = await _search(api, viewer_token, "@BIRDS")
    assert [item["id"] for item in by_alias] == [card["id"]]


async def test_search_exact_alias_goes_first(api: _ApiCtx) -> None:
    """Точное совпадение адреса — первым, даже если канал создан раньше."""
    owner = await api.make_user()
    viewer = await api.make_user()
    token, viewer_token = await api.token_for(owner), await api.token_for(viewer)

    # Точный адрес создаём ПЕРВЫМ (id меньше), «шумные» — после него: при
    # сортировке «новые сверху» точный оказался бы в конце списка.
    exact = await _create_channel(
        api, token, title="Основной", is_public=True, username="pismo"
    )
    await _create_channel(
        api, token, title="Новости", is_public=True, username="pismonews"
    )
    await _create_channel(
        api, token, title="Спорт", is_public=True, username="pismosport"
    )

    found = await _search(api, viewer_token, "pismo")
    assert [item["id"] for item in found][0] == exact["id"]


async def test_search_hides_private_channels_and_chats(api: _ApiCtx) -> None:
    """Приватные каналы и обычные чаты в каталог не попадают."""
    owner = await api.make_user()
    viewer = await api.make_user()
    token, viewer_token = await api.token_for(owner), await api.token_for(viewer)

    await _create_channel(api, token, title="Секретный клуб")  # приватный канал
    await api.private_chat(token, viewer.id)  # личный чат (не канал вовсе)

    assert await _search(api, viewer_token, "клуб") == []
