"""HEIC/HEIF → JPEG: фото с телефона в браузере не показывается.

Samsung и iPhone по умолчанию снимают в HEIC. Ни Chrome, ни Firefox, ни Edge этот
формат не декодируют (умеет только Safari), поэтому история или вложение в нём
выглядели бы у зрителя пустым экраном. До 30.09.2026 такие файлы просто
отклонялись — «Недопустимый тип файла» (владелец: «истории в формате heic не
выкладываются, это изображение с Samsung»).

Поэтому перекодируем на сервере в JPEG — единственный формат, который читают все
браузеры. Заодно уменьшаем кадр: снимок 4000×3000 в JPEG весит мегабайты, а в
ленте историй и в галерее хватает 2560 по большей стороне.

Расширение и mime после перекодирования меняются на `.jpg` / `image/jpeg`: хранить
`heic` с содержимым JPEG нельзя — разошлись бы имя файла, расширение (по нему отдаёт
mime) и то, что видит браузер.
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pillow_heif
from fastapi import HTTPException, status
from PIL import Image, ImageOps

from core.i18n import t

# Декодер HEIF подключаем к Pillow один раз при импорте модуля: дальше `Image.open`
# и `image.save(...)` работают с HEIC как с любым другим форматом.
pillow_heif.register_heif_opener()

#: Бренды HEIF-контейнера: что стоит в поле `ftyp` (major brand).
HEIC_BRANDS = {
    b"heic",
    b"heix",
    b"hevc",
    b"hevx",
    b"heim",
    b"heis",
    b"hevm",
    b"hevs",
    b"mif1",
    b"msf1",
}

#: Расширения, под которыми HEIC приходит от телефонов (нужны там, где имя файла
#: проверяется раньше содержимого — у аватаров).
HEIC_EXTS = {"heic", "heif"}

#: Максимальная сторона кадра после перекодирования.
MAX_EDGE = 2560
JPEG_QUALITY = 88


def looks_like_heic(content: bytes) -> bool:
    """HEIC/HEIF ли это — по сигнатуре, а не по имени файла.

    Имени доверять нельзя: Samsung присылает `.heic`, а часть приложений отдаёт тот
    же контейнер под именем `.jpg`.
    """
    if len(content) < 12 or content[4:8] != b"ftyp":
        return False
    return content[8:12] in HEIC_BRANDS


def jpeg_name(filename: str) -> str:
    """Имя того же файла с расширением `.jpg` (для хранения после перекодирования)."""
    return f"{Path(filename).stem or 'photo'}.jpg"


def heic_to_jpeg(content: bytes) -> bytes:
    """Перекодирует HEIC/HEIF в JPEG, уменьшая кадр до ``MAX_EDGE``.

    Нечитаемый файл — 400 с понятным текстом, а не 500: битый снимок присылает
    человек, а не сбой сервера.
    """
    try:
        with Image.open(BytesIO(content)) as source:
            # Ориентация из EXIF: снимок с телефона иначе лёг бы набок (в JPEG
            # метаданные поворота мы дальше не переносим — незачем).
            image = ImageOps.exif_transpose(source) or source
            if image.mode not in ("RGB", "L"):
                # HEIC бывает с альфа-каналом, а JPEG его не хранит.
                image = image.convert("RGB")
            if max(image.size) > MAX_EDGE:
                image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
            buffer = BytesIO()
            image.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Не удалось прочитать фото HEIC — выберите другое"),
        ) from exc
    return buffer.getvalue()
