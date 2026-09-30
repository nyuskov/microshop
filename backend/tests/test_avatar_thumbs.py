"""Тесты миниатюр аватаров: генерация, запись, удаление и API.

Аватар в интерфейсе — кружок 40–56px, а в хранилище лежит то, что загрузили с
телефона (несколько мегабайт). Миниатюра 128px отдаётся спискам чатов, истории
и пушам. Здесь проверяем:

* уменьшение размера и перевод в JPEG (прозрачность сохраняем как PNG);
* устойчивость к «не картинкам» (загрузка не должна ломаться);
* что через API возвращаются обе ссылки, а удаление убирает оба файла.

БД-часть запускается только при заданном TEST_DATABASE_URL (как остальные
API-тесты).
"""

from __future__ import annotations

import os
from io import BytesIO

import pytest
import pytest_asyncio
from PIL import Image

from core import avatar_store
from core.avatar_store import (
    AVATAR_THUMB_SIZE,
    PUSH_ICON_INNER_RATIO,
    PUSH_ICON_SIZE,
    make_avatar_thumb,
    make_push_icon,
    push_icon_stored_name,
    push_icon_url,
    remove_avatar_files,
    store_avatar,
    thumb_stored_name,
)


def _jpeg_bytes(width: int = 1200, height: int = 900) -> bytes:
    """Шумная картинка: плоская заливка сжимается слишком хорошо."""
    image = Image.new("RGB", (width, height))
    pixels = image.load()
    for x in range(0, width, 3):
        for y in range(0, height, 3):
            pixels[x, y] = ((x * 7 + y * 13) % 256, (x * 3) % 256, (y * 5) % 256)
    buffer = BytesIO()
    image.save(buffer, "JPEG", quality=90)
    return buffer.getvalue()


def _png_with_alpha_bytes(size: int = 600) -> bytes:
    image = Image.new("RGBA", (size, size), (255, 0, 0, 0))
    for x in range(size // 2):
        for y in range(size // 4):
            image.putpixel((x, y), (0, 128, 255, 255))
    buffer = BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


# --- Юнит-тесты генерации (без БД) --------------------------------------


def test_thumb_smaller_and_bounded() -> None:
    original = _jpeg_bytes()
    thumb = make_avatar_thumb(original)
    assert thumb is not None
    data, ext = thumb
    assert ext == "jpg"
    assert len(data) < len(original) / 4
    with Image.open(BytesIO(data)) as image:
        assert max(image.size) <= AVATAR_THUMB_SIZE


def test_thumb_keeps_transparency_as_png() -> None:
    thumb = make_avatar_thumb(_png_with_alpha_bytes())
    assert thumb is not None
    data, ext = thumb
    assert ext == "png"
    with Image.open(BytesIO(data)) as image:
        assert image.mode == "RGBA"


def test_thumb_of_broken_file_is_none() -> None:
    assert make_avatar_thumb(b"<html>not an image</html>") is None


def test_thumb_stored_name() -> None:
    assert thumb_stored_name("user_5_ab12.png", "jpg") == "user_5_ab12_t128.jpg"


def test_store_avatar_writes_both_files(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(avatar_store, "AVATAR_DIR", tmp_path)
    url, thumb_url = store_avatar(_jpeg_bytes(), prefix="user_7", extension="jpg")

    assert thumb_url is not None
    assert url.startswith(avatar_store.AVATAR_URL_PREFIX)
    assert thumb_url.startswith(avatar_store.AVATAR_URL_PREFIX)
    assert (tmp_path / url.rsplit("/", 1)[-1]).is_file()
    assert (tmp_path / thumb_url.rsplit("/", 1)[-1]).is_file()
    assert (tmp_path / thumb_url.rsplit("/", 1)[-1]).stat().st_size < (
        tmp_path / url.rsplit("/", 1)[-1]
    ).stat().st_size


def test_store_avatar_without_thumb_still_saves_original(tmp_path, monkeypatch) -> None:
    # «Не картинка» сюда попасть не может (есть validate_image_upload), но
    # хранилище не должно падать, если Pillow файл не понял.
    monkeypatch.setattr(avatar_store, "AVATAR_DIR", tmp_path)
    url, thumb_url = store_avatar(b"broken", prefix="user_8", extension="png")
    assert thumb_url is None
    assert (tmp_path / url.rsplit("/", 1)[-1]).is_file()


def test_remove_avatar_files_ignores_foreign_paths(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(avatar_store, "AVATAR_DIR", tmp_path)
    ours = tmp_path / "user_1_x.jpg"
    ours.write_bytes(b"x")
    remove_avatar_files("/media/avatars/user_1_x.jpg", "/media/other/keep.jpg", None)
    assert not ours.exists()
    assert (tmp_path.parent / "other").exists() is False


# --- Иконка уведомления (аватар почти во всю плитку) ----------------------


def _png_bytes(size: int = 64, color: tuple[int, int, int] = (10, 200, 90)) -> bytes:
    image = Image.new("RGB", (size, size), color)
    buffer = BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


def _inner_box() -> tuple[int, int, int, int]:
    """Место аватара внутри иконки — считается из `PUSH_ICON_INNER_RATIO`."""
    inner = round(PUSH_ICON_SIZE * PUSH_ICON_INNER_RATIO)
    offset = (PUSH_ICON_SIZE - inner) // 2
    return (offset, offset, offset + inner, offset + inner)


def test_push_icon_bigger_than_before_but_not_edge_to_edge() -> None:
    """Аватар крупный (заметно больше прежних 70 %), но плитку не распирает."""
    icon = make_push_icon(_jpeg_bytes())
    assert icon is not None
    with Image.open(BytesIO(icon)) as image:
        assert image.mode == "RGBA"
        assert image.size == (PUSH_ICON_SIZE, PUSH_ICON_SIZE)
        # Угол — поле, весь аватар лежит в рамке `_inner_box()`.
        assert image.getpixel((0, 0))[3] == 0
        assert image.getbbox() == _inner_box()
    # Аватар меньше прежних 70 % плитки (владелец просил уменьшать дважды), но
    # заметный: на пятой части плитки его уже не разглядеть.
    assert 0.4 <= PUSH_ICON_INNER_RATIO < 0.7


def test_push_icon_upscales_small_avatar_to_the_same_box() -> None:
    """Мелкий аватар растягиваем до того же места: иначе он снова мелкий."""
    icon = make_push_icon(_png_bytes(64))
    assert icon is not None
    with Image.open(BytesIO(icon)) as image:
        assert image.getbbox() == _inner_box()


def test_push_icon_crops_wide_avatar_to_square() -> None:
    """Широкий аватар обрезаем по центру: прозрачных полос по краям быть не должно."""
    with Image.new("RGB", (400, 200), (10, 200, 90)) as wide:
        buffer = BytesIO()
        wide.save(buffer, "PNG")

    icon = make_push_icon(buffer.getvalue())

    assert icon is not None
    with Image.open(BytesIO(icon)) as image:
        assert image.getbbox() == _inner_box()


def test_push_icon_rejects_non_image() -> None:
    assert make_push_icon(b"<html>not an image</html>") is None


def test_push_icon_stored_name_ignores_thumb_suffix() -> None:
    assert push_icon_stored_name("user_5_ab12.png") == "user_5_ab12_n256r50.png"
    # Имя миниатюры даёт ту же иконку: иначе от одного аватара было бы две.
    assert push_icon_stored_name("user_5_ab12_t128.jpg") == "user_5_ab12_n256r50.png"


def test_push_icon_url_generates_for_existing_avatar(tmp_path, monkeypatch) -> None:
    """Аватар загружен до появления иконок — делаем её на месте."""
    monkeypatch.setattr(avatar_store, "AVATAR_DIR", tmp_path)
    (tmp_path / "user_9_ff.jpg").write_bytes(_jpeg_bytes())

    url = push_icon_url("/media/avatars/user_9_ff.jpg")

    assert url == "/media/avatars/user_9_ff_n256r50.png"
    assert (tmp_path / "user_9_ff_n256r50.png").is_file()


def test_push_icon_url_generates_from_thumb_when_original_is_gone(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(avatar_store, "AVATAR_DIR", tmp_path)
    (tmp_path / "user_9_ff_t128.jpg").write_bytes(_jpeg_bytes())

    url = push_icon_url(
        "/media/avatars/user_9_ff.jpg", "/media/avatars/user_9_ff_t128.jpg"
    )

    assert url == "/media/avatars/user_9_ff_n256r50.png"


def test_push_icon_url_none_without_files(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(avatar_store, "AVATAR_DIR", tmp_path)
    assert push_icon_url("/media/avatars/missing.jpg") is None
    assert push_icon_url(None, "") is None
    assert push_icon_url("/media/stickers/other.png") is None


def test_store_avatar_writes_push_icon(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(avatar_store, "AVATAR_DIR", tmp_path)
    url, _ = store_avatar(_jpeg_bytes(), prefix="user_11", extension="jpg")

    name = push_icon_stored_name(url.rsplit("/", 1)[-1])
    assert (tmp_path / name).is_file()


def test_remove_avatar_files_removes_push_icon(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(avatar_store, "AVATAR_DIR", tmp_path)
    (tmp_path / "user_1_x.jpg").write_bytes(b"x")
    (tmp_path / "user_1_x_n256r50.png").write_bytes(b"x")

    remove_avatar_files("/media/avatars/user_1_x.jpg")

    assert not (tmp_path / "user_1_x_n256r50.png").exists()


# --- API: загрузка и удаление -------------------------------------------

# Фикстура API-теста (httpx поверх приложения) живёт в test_messenger_api —
# импортируем её сюда, чтобы не дублировать ~60 строк настройки окружения.
from tests.test_messenger_api import _ApiCtx  # noqa: E402
from tests.test_messenger_api import api as api_fixture  # noqa: E402,F401

#: Без БД запускаем только юнит-тесты (они работают с файлами в tmp_path).
needs_db = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


@pytest_asyncio.fixture
async def api(api_fixture: _ApiCtx) -> _ApiCtx:  # noqa: F811
    """Тот же контекст API-тестов, что и в test_messenger_api."""
    return api_fixture


async def _peer_avatar(api: _ApiCtx, token: str, peer_id: int) -> str | None:
    """Какой avatar_url собеседника отдаёт список чатов."""
    response = await api.client.get("/api/v1/chats/", headers=api.auth(token))
    assert response.status_code == 200, response.text
    for chat in response.json():
        for member in chat["users"]:
            if member["id"] == peer_id:
                return member["avatar_thumb_url"]
    raise AssertionError("собеседник не найден в списке чатов")


@needs_db
async def test_upload_avatar_returns_thumb_and_delete_removes_files(
    api: _ApiCtx,
) -> None:
    user = await api.make_user()
    token = await api.token_for(user)
    peer = await api.make_user()
    await api.private_chat(token, peer.id)

    response = await api.client.put(
        "/api/v1/users/me/avatar/",
        params={"ext": "jpg"},
        content=_jpeg_bytes(),
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["avatar_url"]
    thumb_url = body["avatar_thumb_url"]
    assert thumb_url

    original = avatar_store.AVATAR_DIR / body["avatar_url"].rsplit("/", 1)[-1]
    thumb = avatar_store.AVATAR_DIR / thumb_url.rsplit("/", 1)[-1]
    assert original.is_file() and thumb.is_file()
    assert thumb.stat().st_size < original.stat().st_size
    with Image.open(thumb) as image:
        assert max(image.size) <= AVATAR_THUMB_SIZE

    # Собеседник видит миниатюру в списке чатов (там аватар показывается кружком).
    assert await _peer_avatar(api, token, user.id) == thumb_url

    response = await api.client.delete(
        "/api/v1/users/me/avatar/", headers=api.auth(token)
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"avatar_url": None, "avatar_thumb_url": None}
    assert not original.exists()
    assert not thumb.exists()
    assert await _peer_avatar(api, token, user.id) is None


@needs_db
async def test_reupload_avatar_removes_previous_files(api: _ApiCtx) -> None:
    """Новая загрузка не должна оставлять старые файлы (иначе media течёт)."""
    user = await api.make_user()
    token = await api.token_for(user)

    first = (
        await api.client.put(
            "/api/v1/users/me/avatar/",
            params={"ext": "jpg"},
            content=_jpeg_bytes(400, 400),
            headers={**api.auth(token), "Content-Type": "application/octet-stream"},
        )
    ).json()
    second = (
        await api.client.put(
            "/api/v1/users/me/avatar/",
            params={"ext": "jpg"},
            content=_jpeg_bytes(500, 500),
            headers={**api.auth(token), "Content-Type": "application/octet-stream"},
        )
    ).json()

    for url in (first["avatar_url"], first["avatar_thumb_url"]):
        assert not (avatar_store.AVATAR_DIR / url.rsplit("/", 1)[-1]).exists()
    for url in (second["avatar_url"], second["avatar_thumb_url"]):
        assert (avatar_store.AVATAR_DIR / url.rsplit("/", 1)[-1]).is_file()


@needs_db
async def test_group_avatar_has_thumb_and_is_removed(api: _ApiCtx) -> None:
    """Аватар группы тоже с миниатюрой: в списке чатов он показывается кружком."""
    creator = await api.make_user()
    token = await api.token_for(creator)
    member = await api.make_user()

    response = await api.client.post(
        "/api/v1/chats/groups/",
        json={"name": "Тестовая группа", "user_ids": [member.id]},
        headers=api.auth(token),
    )
    assert response.status_code == 200, response.text
    chat_id = response.json()["id"]

    response = await api.client.post(
        f"/api/v1/chats/{chat_id}/avatar/",
        params={"ext": "jpg"},
        content=_jpeg_bytes(),
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["avatar_url"] and body["avatar_thumb_url"]

    original = avatar_store.AVATAR_DIR / body["avatar_url"].rsplit("/", 1)[-1]
    thumb = avatar_store.AVATAR_DIR / body["avatar_thumb_url"].rsplit("/", 1)[-1]
    assert original.is_file() and thumb.is_file()
    assert thumb.stat().st_size < original.stat().st_size

    # Список чатов у участника отдаёт миниатюру группы.
    response = await api.client.get("/api/v1/chats/", headers=api.auth(token))
    card = [c for c in response.json() if c["id"] == chat_id][0]
    assert card["avatar_thumb_url"] == body["avatar_thumb_url"]

    response = await api.client.delete(
        f"/api/v1/chats/{chat_id}/avatar/", headers=api.auth(token)
    )
    assert response.status_code == 200, response.text
    assert response.json()["avatar_url"] is None
    assert response.json()["avatar_thumb_url"] is None
    assert not original.exists() and not thumb.exists()


@needs_db
async def test_heic_avatar_from_samsung_is_converted(api: _ApiCtx) -> None:
    """Аватар из галереи Samsung (HEIC) принимается и хранится как JPEG.

    Тот же случай, что и с историями (30.09.2026): расширения `heic` не было в
    белом списке, поэтому фото с телефона отбивалось как «Недопустимый формат
    файла». Браузеры HEIC не показывают — значит, доводим до JPEG на сервере.
    """
    user = await api.make_user()
    token = await api.token_for(user)

    buffer = BytesIO()
    Image.new("RGB", (600, 600), (200, 30, 30)).save(buffer, format="HEIF")

    response = await api.client.put(
        "/api/v1/users/me/avatar/",
        params={"ext": "heic"},
        content=buffer.getvalue(),
        headers={**api.auth(token), "Content-Type": "application/octet-stream"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    original = avatar_store.AVATAR_DIR / body["avatar_url"].rsplit("/", 1)[-1]
    assert original.is_file()
    # На диске — JPEG: иначе аватар не покажет ни один браузер, кроме Safari.
    with Image.open(original) as image:
        assert image.format == "JPEG"
    assert body["avatar_thumb_url"]
