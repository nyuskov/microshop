"""HEIC → JPEG: фото с Samsung и iPhone доходит до ленты, чата и аватара.

Владелец (30.09.2026): «истории в формате heic не выкладываются, это изображение с
Samsung». Причина была в белом списке расширений: HEIC отбивался как «Недопустимый
тип файла», хотя и пропущенный он был бы бесполезен — HEIC не показывает ни один
браузер, кроме Safari. Поэтому сервер перекодирует такое фото в JPEG
(`core/image_convert.py`), а здесь проверяется сама конвертация: приём файлов — в
тестах историй, вложений и аватара.
"""

from __future__ import annotations

from io import BytesIO

import pytest
from fastapi import HTTPException
from PIL import Image

from core.image_convert import (
    HEIC_EXTS,
    MAX_EDGE,
    heic_to_jpeg,
    jpeg_name,
    looks_like_heic,
)


def _heic(size: tuple[int, int] = (320, 240)) -> bytes:
    """Настоящий HEIC: кодировщик libheif входит в колесо pillow-heif."""
    buffer = BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(buffer, format="HEIF")
    return buffer.getvalue()


def _jpeg(size: tuple[int, int] = (8, 8)) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", size, (10, 20, 30)).save(buffer, format="JPEG")
    return buffer.getvalue()


def _png(size: int = 8) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (size, size), (10, 20, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


def test_heic_is_recognized_by_signature() -> None:
    """Формат узнаём по сигнатуре, а не по имени: часть приложений отдаёт тот же
    контейнер под именем `.jpg`, а расширению в запросе верить нельзя."""
    assert looks_like_heic(_heic()) is True
    assert looks_like_heic(_jpeg()) is False
    assert looks_like_heic(b"") is False
    assert looks_like_heic(b"\x89PNG\r\n\x1a\n") is False


def test_heic_becomes_jpeg() -> None:
    converted = heic_to_jpeg(_heic())
    assert converted[:3] == b"\xff\xd8\xff"
    with Image.open(BytesIO(converted)) as image:
        assert image.format == "JPEG"
        assert image.size == (320, 240)


def test_large_heic_is_shrunk_to_max_edge() -> None:
    """Снимок телефона 4000×3000 в JPEG весит мегабайты — уменьшаем по большей
    стороне: в ленте историй и в галерее 2560 хватает с запасом."""
    with Image.open(BytesIO(heic_to_jpeg(_heic((MAX_EDGE + 40, 100))))) as image:
        assert max(image.size) == MAX_EDGE


def test_other_formats_pass_through_untouched() -> None:
    """Чужой формат не трогаем: перекодирование потеряло бы качество зря.

    На этом и стоит приём файлов: конвертацию зовут только под `looks_like_heic`,
    поэтому JPEG, PNG и WebP идут дальше как есть.
    """
    assert looks_like_heic(_jpeg()) is False
    assert looks_like_heic(_png()) is False


def test_name_and_mime_change_together_with_content() -> None:
    """Имя и mime меняются вместе с содержимым: хранить `heic` с байтами JPEG
    нельзя — разошлись бы расширение (по нему отдаётся тип) и сам файл."""
    converted = heic_to_jpeg(_heic())
    assert converted[:3] == b"\xff\xd8\xff"
    assert jpeg_name("IMG_20260930_1201.heic") == "IMG_20260930_1201.jpg"


def test_jpeg_name_keeps_stem_only() -> None:
    assert jpeg_name("photo.heic") == "photo.jpg"
    assert jpeg_name("photo.HEIF") == "photo.jpg"
    assert jpeg_name("photo") == "photo.jpg"
    assert jpeg_name("20260930_1201.heic") == "20260930_1201.jpg"


def test_broken_heic_gives_clear_400() -> None:
    """Битый файл — 400 с понятным текстом, а не 500: его присылает человек."""
    broken = b"\x00\x00\x00\x18ftypheic" + b"not really a photo" * 4
    assert looks_like_heic(broken) is True
    with pytest.raises(HTTPException) as exc:
        heic_to_jpeg(broken)
    assert exc.value.status_code == 400
    assert "HEIC" in str(exc.value.detail)


def test_heic_exts_cover_phone_spellings() -> None:
    """Расширения, под которыми HEIC приходит от телефонов (нужны аватарам: там имя
    проверяется раньше содержимого)."""
    assert HEIC_EXTS == {"heic", "heif"}
