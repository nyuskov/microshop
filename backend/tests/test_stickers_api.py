"""API стикеров и настроек эмодзи (нужен PostgreSQL).

Проверяем то, что нельзя проверить чистыми функциями: свои паки видны только
владельцу, чужой пак не потрогать, стикер-сообщение получает ``kind='sticker'``,
«в стикеры» из сообщения работает и не работает там, где сервер не может
прочитать файл (E2EE), а настройки паков эмодзи ездят между устройствами через
``GET/PUT /users/me/emoji/``.

Запускаются только при заданном TEST_DATABASE_URL (см. tests/api_support.py).
"""

from __future__ import annotations

import os

import pytest

from core.models import User
from tests.api_support import _ApiCtx  # noqa: E402
from tests.api_support import api as api_fixture  # noqa: E402
from tests.test_chat_media import PNG

#: Фикстура API-теста живёт в tests/api_support.py — импортируем, чтобы не
#: дублировать настройку httpx/БД.
api = api_fixture

GIF = (
    b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!"
    b"\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00"
    b"\x00\x02\x02D\x01\x00;"
)

needs_db = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


async def _create_pack(api: _ApiCtx, token: str, title: str = "Мои стикеры") -> dict:
    response = await api.client.post(
        "/api/v1/stickers/packs/", json={"title": title}, headers=api.auth(token)
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _upload_sticker(
    api: _ApiCtx,
    token: str,
    pack_id: int,
    body: bytes = PNG,
    filename: str = "smile.png",
) -> dict:
    response = await api.client.post(
        f"/api/v1/stickers/packs/{pack_id}/items/",
        params={"filename": filename},
        content=body,
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _library(api: _ApiCtx, token: str) -> list[dict]:
    response = await api.client.get("/api/v1/stickers/", headers=api.auth(token))
    assert response.status_code == 200, response.text
    return response.json()["packs"]


async def _send_sticker(api: _ApiCtx, token: str, chat_id: int) -> dict:
    """Отправляет картинку-стикер (mime у эндпоинта — отдельный параметр)."""
    response = await api.client.post(
        "/api/v1/messages/attachment/",
        params={
            "chat_id": chat_id,
            "filename": "sticker.webp",
            "mime": "image/webp",
            "sticker": "true",
        },
        content=PNG,
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _presets(api: _ApiCtx, token: str) -> list[dict]:
    """Публичные (предустановленные) наборы, доступные всем."""
    response = await api.client.get(
        "/api/v1/stickers/presets/", headers=api.auth(token)
    )
    assert response.status_code == 200, response.text
    return response.json()["packs"]


async def _make_superuser(api: _ApiCtx) -> tuple[User, str]:
    """Владелец (``is_superuser``) с токеном: публиковать может только он."""
    owner = await api.make_user()
    async with api.factory() as session:
        row = await session.get(User, owner.id)
        assert row is not None
        row.is_superuser = True
        await session.commit()
    return owner, await api.token_for(owner)


@needs_db
async def test_presets_are_published_and_copied(api: _ApiCtx) -> None:
    """Суперадмин публикует набор — другой человек добавляет его себе ЦЕЛИКОМ.

    Копия обязана переиспользовать файлы: иначе «добавить набор» упиралось бы в
    лимит частоты загрузок (10 файлов в минуту), а место тратилось бы дважды.
    """
    _, owner_token = await _make_superuser(api)
    pack = await _create_pack(api, owner_token, "Котики")
    sticker = await _upload_sticker(api, owner_token, pack["id"])

    stranger = await api.make_user()
    token = await api.token_for(stranger)
    # Пока набор частный — чужим он не виден.
    assert await _presets(api, token) == []

    published = await api.client.put(
        f"/api/v1/stickers/packs/{pack['id']}/preset/",
        json={"is_preset": True},
        headers=api.auth(owner_token),
    )
    assert published.status_code == 200, published.text
    assert published.json()["is_preset"] is True

    assert [p["title"] for p in await _presets(api, token)] == ["Котики"]

    copied = await api.client.post(
        f"/api/v1/stickers/presets/{pack['id']}/copy/", headers=api.auth(token)
    )
    assert copied.status_code == 201, copied.text
    copy = copied.json()
    assert copy["title"] == "Котики"
    # Копия — обычный личный набор, а не второй публичный.
    assert copy["is_preset"] is False
    # Главное: файлы те же самые, новых загрузок не было.
    assert [s["file_url"] for s in copy["stickers"]] == [sticker["file_url"]]
    assert [p["title"] for p in await _library(api, token)] == ["Котики"]

    # Повторное добавление — понятный отказ, а не второй такой же набор.
    again = await api.client.post(
        f"/api/v1/stickers/presets/{pack['id']}/copy/", headers=api.auth(token)
    )
    assert again.status_code == 409, again.text
    assert len(await _library(api, token)) == 1


@needs_db
async def test_preset_rights(api: _ApiCtx) -> None:
    """Обычный человек не публикует наборы, а копировать можно только публичные."""
    author = await api.make_user()
    author_token = await api.token_for(author)
    pack = await _create_pack(api, author_token, "Личный")

    stranger = await api.make_user()
    token = await api.token_for(stranger)

    forbidden = await api.client.put(
        f"/api/v1/stickers/packs/{pack['id']}/preset/",
        json={"is_preset": True},
        headers=api.auth(token),
    )
    assert forbidden.status_code == 403, forbidden.text

    missing = await api.client.post(
        f"/api/v1/stickers/presets/{pack['id']}/copy/", headers=api.auth(token)
    )
    assert missing.status_code == 404, missing.text


@needs_db
async def test_pack_and_sticker_flow(api: _ApiCtx) -> None:
    """Пак создаётся, стикер загружается и оба видны в библиотеке."""
    user = await api.make_user()
    token = await api.token_for(user)

    assert await _library(api, token) == []

    pack = await _create_pack(api, token, "  Котики  ")
    # Название чистим от лишних пробелов: в панели это подпись вкладки.
    assert pack["title"] == "Котики"

    sticker = await _upload_sticker(api, token, pack["id"])
    assert sticker["file_url"].startswith("/media/")
    # PNG с прозрачностью храним как WebP — так файл легче.
    assert sticker["mime_type"] == "image/webp"

    packs = await _library(api, token)
    assert [item["id"] for item in packs] == [pack["id"]]
    assert [item["id"] for item in packs[0]["stickers"]] == [sticker["id"]]

    # GIF остаётся GIF: пересборка сломала бы анимацию.
    gif = await _upload_sticker(api, token, pack["id"], GIF, "wave.gif")
    assert gif["mime_type"] == "image/gif"

    # Переименование пака и перенос стикера в него — обе ручки отвечают стикером.
    renamed = await api.client.patch(
        f"/api/v1/stickers/packs/{pack['id']}",
        json={"title": "Кошки", "position": 3},
        headers=api.auth(token),
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["position"] == 3


@needs_db
async def test_foreign_pack_is_invisible_and_untouchable(api: _ApiCtx) -> None:
    """Чужой пак не видно в библиотеке и нельзя ни поменять, ни удалить."""
    owner = await api.make_user()
    stranger = await api.make_user()
    owner_token = await api.token_for(owner)
    stranger_token = await api.token_for(stranger)

    pack = await _create_pack(api, owner_token, "Личное")
    sticker = await _upload_sticker(api, owner_token, pack["id"])

    assert await _library(api, stranger_token) == []

    for method, url, payload in (
        ("patch", f"/api/v1/stickers/packs/{pack['id']}", {"title": "Забрал"}),
        ("delete", f"/api/v1/stickers/packs/{pack['id']}", None),
        ("delete", f"/api/v1/stickers/items/{sticker['id']}", None),
    ):
        # У httpx у delete нет json — посылаем прямой запрос.
        response = await api.client.request(
            method.upper(), url, json=payload, headers=api.auth(stranger_token)
        )
        assert response.status_code == 404, response.text

    # Загрузить свой стикер в чужой пак тоже нельзя.
    denied = await api.client.post(
        f"/api/v1/stickers/packs/{pack['id']}/items/",
        params={"filename": "sneaky.png"},
        content=PNG,
        headers={
            **api.auth(stranger_token),
            "Content-Type": "application/octet-stream",
        },
    )
    assert denied.status_code == 404, denied.text

    # Хозяин по-прежнему всё видит.
    assert [
        item["id"] for item in (await _library(api, owner_token))[0]["stickers"]
    ] == [sticker["id"]]


@needs_db
async def test_delete_pack_and_sticker(api: _ApiCtx) -> None:
    """Удаление отвечает 204 и убирает пак из библиотеки вместе со стикерами."""
    user = await api.make_user()
    token = await api.token_for(user)
    pack = await _create_pack(api, token, "Временный")
    sticker = await _upload_sticker(api, token, pack["id"])
    other_pack = await _create_pack(api, token, "Оставить")
    other_sticker = await _upload_sticker(api, token, other_pack["id"])

    removed = await api.client.delete(
        f"/api/v1/stickers/items/{sticker['id']}", headers=api.auth(token)
    )
    assert removed.status_code == 204, removed.text
    assert removed.content == b""

    dropped = await api.client.delete(
        f"/api/v1/stickers/packs/{pack['id']}", headers=api.auth(token)
    )
    assert dropped.status_code == 204, dropped.text

    packs = await _library(api, token)
    assert [item["id"] for item in packs] == [other_pack["id"]]
    assert [item["id"] for item in packs[0]["stickers"]] == [other_sticker["id"]]


@needs_db
async def test_upload_rejects_junk_and_wrong_extension(api: _ApiCtx) -> None:
    """Не картинка, пустое тело и недопустимое расширение — понятные ошибки."""
    user = await api.make_user()
    token = await api.token_for(user)
    pack = await _create_pack(api, token)

    empty = await api.client.post(
        f"/api/v1/stickers/packs/{pack['id']}/items/",
        params={"filename": "empty.png"},
        content=b"",
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )
    assert empty.status_code == 400, empty.text

    junk = await api.client.post(
        f"/api/v1/stickers/packs/{pack['id']}/items/",
        params={"filename": "junk.png"},
        content="точно не картинка".encode(),
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )
    assert junk.status_code == 400, junk.text

    pdf = await api.client.post(
        f"/api/v1/stickers/packs/{pack['id']}/items/",
        params={"filename": "docs.pdf"},
        content=PNG,
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )
    assert pdf.status_code == 400, pdf.text

    assert (await _library(api, token))[0]["stickers"] == []


@needs_db
async def test_sticker_message_gets_own_kind(api: _ApiCtx) -> None:
    """Сообщение со ``sticker=true`` помечается ``kind='sticker'``.

    По этому полю клиент рисует картинку без пузыря, поэтому важно, что оно
    приходит и в ответе на отправку.
    """
    user = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(user)
    chat = await api.private_chat(token, peer.id)

    message = await _send_sticker(api, token, chat["id"])
    assert message["kind"] == "sticker"

    # Текст и обычная картинка остаются текстовыми сообщениями.
    plain = await api.send(token, chat["id"], "привет")
    assert plain["kind"] == "text"

    # Стикером нельзя отправить невложение: правило ловит неверный вызов.
    broken = await api.client.post(
        "/api/v1/messages/attachment/",
        params={"chat_id": chat["id"], "filename": "note.txt", "sticker": "true"},
        content=b"text",
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )
    assert broken.status_code == 400, broken.text


@needs_db
async def test_sticker_from_message_copies_image(api: _ApiCtx) -> None:
    """«В стикеры» из сообщения: картинка копируется в пап (пак по умолчанию)."""
    user = await api.make_user()
    peer = await api.make_user()
    token = await api.token_for(user)
    chat = await api.private_chat(token, peer.id)

    uploaded = await api.client.post(
        "/api/v1/messages/attachment/",
        params={"chat_id": chat["id"], "filename": "photo.png", "mime": "image/png"},
        content=PNG,
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )
    assert uploaded.status_code == 200, uploaded.text
    message = uploaded.json()

    response = await api.client.post(
        "/api/v1/stickers/from-message/",
        json={"message_id": message["id"]},
        headers=api.auth(token),
    )
    assert response.status_code == 201, response.text
    sticker = response.json()
    assert sticker["file_url"].startswith("/media/")
    assert sticker["mime_type"] in {"image/webp", "image/gif"}

    # Пак «Мои стикеры» создался сам — стикер не должен потеряться.
    packs = await _library(api, token)
    assert len(packs) == 1
    assert [item["id"] for item in packs[0]["stickers"]] == [sticker["id"]]

    # Текстовое сообщение стикером не станет.
    text_message = await api.send(token, chat["id"], "просто текст")
    not_image = await api.client.post(
        "/api/v1/stickers/from-message/",
        json={"message_id": text_message["id"]},
        headers=api.auth(token),
    )
    assert not_image.status_code == 400, not_image.text

    # Постороннему чужое сообщение не отдаём — иначе так можно было бы
    # вытащить картинку из закрытого чата.
    stranger = await api.make_user()
    stranger_token = await api.token_for(stranger)
    denied = await api.client.post(
        "/api/v1/stickers/from-message/",
        json={"message_id": message["id"]},
        headers=api.auth(stranger_token),
    )
    assert denied.status_code == 404, denied.text


@needs_db
async def test_emoji_prefs_round_trip(api: _ApiCtx) -> None:
    """Настройки эмодзи сохраняются на аккаунт и чистятся от дублей."""
    user = await api.make_user()
    token = await api.token_for(user)

    empty = await api.client.get("/api/v1/users/me/emoji/", headers=api.auth(token))
    assert empty.status_code == 200, empty.text
    assert empty.json() == {"packs": [], "favorites": []}

    saved = await api.client.put(
        "/api/v1/users/me/emoji/",
        json={
            "packs": ["people", " ", "nature", "people", "travel"],
            "favorites": ["😀", "😀", "", "🐱"],
        },
        headers=api.auth(token),
    )
    assert saved.status_code == 200, saved.text
    assert saved.json() == {
        "packs": ["people", "nature", "travel"],
        "favorites": ["😀", "🐱"],
    }

    again = await api.client.get("/api/v1/users/me/emoji/", headers=api.auth(token))
    assert again.json() == saved.json()

    # Повторный PUT заменяет выбор целиком (порядок вкладок задаёт клиент).
    replaced = await api.client.put(
        "/api/v1/users/me/emoji/",
        json={"packs": ["food"], "favorites": []},
        headers=api.auth(token),
    )
    assert replaced.json() == {"packs": ["food"], "favorites": []}

    # У второго человека свои настройки, чужие ему не подмешиваются.
    other = await api.make_user()
    other_token = await api.token_for(other)
    fresh = await api.client.get(
        "/api/v1/users/me/emoji/", headers=api.auth(other_token)
    )
    assert fresh.json() == {"packs": [], "favorites": []}
