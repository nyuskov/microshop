"""Стикеры: что считаем стикером и как приводим картинку к нашему виду.

Стикер — это картинка с прозрачностью, которую показывают ~160 px без подложки.
Отсюда правила:

* **форматы** — PNG, WebP и GIF (прозрачность умеют все три);
* **вес** — до 512 КБ: стикеры шлют часто, и тяжёлый файл бьёт по трафику
  сильнее, чем обычная картинка в переписке;
* **сторона** — до 512 px: крупнее показывать всё равно негде, а лишние
  пиксели только утяжеляют файл;
* **GIF не пережимаем**: у анимации нельзя «уменьшить качество» без потери
  кадров, поэтому слишком большой GIF честно отклоняем с подсказкой.

Почему приведение к виду нужно: «сохранить в стикеры» из сообщения — обычное
дело, а в переписке картинки бывают и 4000 px, и на 3 МБ. Вместо отказа
уменьшаем (прозрачность сохраняется — результат всегда WebP).
"""

from __future__ import annotations

from io import BytesIO

from PIL import Image, UnidentifiedImageError

#: Расширения, которые принимаем как стикер (и их типы содержимого).
STICKER_MIME: dict[str, str] = {
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
}

#: Предел веса файла стикера.
MAX_STICKER_BYTES = 512 * 1024

#: Предел стороны (px): крупнее стикер всё равно не показывается.
MAX_STICKER_SIDE = 512

#: Сколько паков и стикеров разрешено держать одному человеку.
MAX_STICKER_PACKS = 20
MAX_STICKERS_PER_PACK = 60

#: Длина названия пака (совпадает с колонкой `sticker_packs.title`).
MAX_PACK_TITLE = 60


def normalize_pack_title(raw: str) -> str:
    """Название пака: убираем лишние пробелы и режем по длине.

    Пустое название недопустимо — панель без подписи выглядит как сбой, поэтому
    подставляем «Мои стикеры».
    """
    title = " ".join(raw.split())
    if not title:
        return "Мои стикеры"
    return title[:MAX_PACK_TITLE]


def fit_sticker(content: bytes) -> tuple[bytes, str] | None:
    """Приводит картинку к стикеру: не больше 512 px и 512 КБ.

    Возвращает ``(данные, расширение)`` или ``None``, если из картинки стикер
    сделать нельзя: не изображение, анимация больше предела (её не пережать) или
    картинка настолько тяжёлая, что и после сжатия не влезает.

    Что делаем с PNG/WebP: уменьшаем по большей стороне до 512 px, сохраняем
    WebP с прозрачностью; если он всё ещё больше предела — пробуем сжатие с
    потерями (quality 80), оно для стикеров почти незаметно.
    """
    if not content:
        return None
    # GIF отдаём как есть: это может быть анимация, и любая пересборка её сломает.
    if _looks_like_gif(content):
        if len(content) > MAX_STICKER_BYTES:
            return None
        return content, "gif"

    try:
        with Image.open(BytesIO(content)) as source:
            image = source.convert("RGBA")
    except (UnidentifiedImageError, OSError, ValueError):
        return None

    image.thumbnail((MAX_STICKER_SIDE, MAX_STICKER_SIDE), Image.Resampling.LANCZOS)
    lossless = _to_webp(image, lossless=True)
    if len(lossless) <= MAX_STICKER_BYTES:
        return lossless, "webp"
    lossy = _to_webp(image, lossless=False)
    if len(lossy) <= MAX_STICKER_BYTES:
        return lossy, "webp"
    return None


def _to_webp(image: Image.Image, *, lossless: bool) -> bytes:
    """Кодирует картинку в WebP (прозрачность сохраняется)."""
    buffer = BytesIO()
    if lossless:
        image.save(buffer, format="WEBP", lossless=True, method=4)
    else:
        image.save(buffer, format="WEBP", quality=80, method=4)
    return buffer.getvalue()


def _looks_like_gif(content: bytes) -> bool:
    """Похож ли файл на GIF (сигнатура GIF87a/GIF89a)."""
    return content[:6] in (b"GIF87a", b"GIF89a")
