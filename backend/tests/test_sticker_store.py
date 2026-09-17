"""Правила стикеров: приведение картинки к виду и названия паков.

Без БД и без HTTP: здесь чистые функции, которые определяют, что вообще можно
сохранить стикером. Ошибка тут видна пользователю как «стикер не добавился» или
как непомерно тяжёлый файл в переписке, поэтому проверяем границы: слишком
большая анимация, слишком крупная картинка, мусор вместо картинки.
"""

from __future__ import annotations

from io import BytesIO

from PIL import Image

from core.sticker_store import (
    MAX_PACK_TITLE,
    MAX_STICKER_BYTES,
    MAX_STICKER_SIDE,
    fit_sticker,
    normalize_pack_title,
)


def _image(
    width: int = 64, height: int = 64, *, mode: str = "RGBA", fmt: str = "PNG"
) -> bytes:
    """Картинка заданного размера (для проверок уменьшения и форматов)."""
    buffer = BytesIO()
    if mode == "P":
        # У палитрового режима должна быть палитра, поэтому идём через RGB.
        image = Image.new("RGB", (width, height), (200, 30, 30)).convert("P")
    else:
        image = Image.new(mode, (width, height), (200, 30, 30, 128))
    image.save(buffer, format=fmt)
    return buffer.getvalue()


def _noisy_png(size: int = 700) -> bytes:
    """«Фотографичная» картинка: PNG в таких размерах заведомо больше 512 КБ."""
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            pixels[x, y] = ((x * 7 + y * 13) % 256, (x * 3) % 256, (y * 5) % 256)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_small_png_becomes_webp() -> None:
    """PNG с прозрачностью превращается в WebP — так файл легче."""
    fitted = fit_sticker(_image(64, 64))

    assert fitted is not None
    data, ext = fitted
    assert ext == "webp"
    assert len(data) <= MAX_STICKER_BYTES
    assert Image.open(BytesIO(data)).size == (64, 64)


def test_large_image_is_shrunk_to_limit() -> None:
    """Крупную картинку уменьшаем по большей стороне, а не отклоняем."""
    fitted = fit_sticker(_noisy_png(700))

    assert fitted is not None
    data, ext = fitted
    assert ext == "webp"
    width, height = Image.open(BytesIO(data)).size
    assert max(width, height) <= MAX_STICKER_SIDE
    assert len(data) <= MAX_STICKER_BYTES


def test_small_gif_stays_gif() -> None:
    """Мелкий GIF не пересобираем: это может быть анимация."""
    gif = _image(32, 32, mode="P", fmt="GIF")

    fitted = fit_sticker(gif)

    assert fitted == (gif, "gif")


def test_big_gif_is_rejected() -> None:
    """Большой GIF честно отклоняем: пережать анимацию без потери кадров нельзя."""
    big_gif = _image(600, 600, mode="P", fmt="GIF")
    # Настоящий вес важнее: добиваем содержимое комментариями GIF до предела.
    big_gif = big_gif + b"\x00" * MAX_STICKER_BYTES

    assert fit_sticker(big_gif) is None


def test_junk_is_rejected() -> None:
    """Не картинка и пустое тело — не стикер."""
    assert fit_sticker(b"") is None
    assert fit_sticker("это точно не картинка".encode()) is None
    assert fit_sticker(b"<html><body>no</body></html>") is None


def test_pack_title_is_trimmed_and_never_empty() -> None:
    """Название пака: лишние пробелы убираем, пустое заменяем на понятное."""
    assert normalize_pack_title("  Мои   стикеры ") == "Мои стикеры"
    assert normalize_pack_title("   ") == "Мои стикеры"
    assert len(normalize_pack_title("я" * 200)) == MAX_PACK_TITLE
