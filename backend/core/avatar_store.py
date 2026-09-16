"""Аватары: маленькая копия файла для списков и шапок.

Зачем: аватар показывается кружком 40–56px, а в хранилище лежит то, что
загрузили с телефона — часто несколько мегабайт. Список чатов тянет аватар на
каждую строку, поэтому для списков отдаём отдельную миниатюру: она меньше
оригинала в десятки раз, а на экране неотличима.

Pillow может не открыть файл (битый или необычный формат) — это не повод ломать
загрузку: миниатюры просто не будет, а клиент покажет оригинал (см.
``avatar_thumb_url`` в схемах).

Файлы пишутся через ``core.media_crypto``: при заданном ``AT_REST_KEY`` на диске
лежат зашифрованными (иначе шифрование текстов сообщений обходилось бы картинкой
с тем же содержимым).
"""

from io import BytesIO
from pathlib import Path
from uuid import uuid4

from PIL import Image, UnidentifiedImageError

from core.media_crypto import write_file

#: Каталог аватаров (оригиналы и миниатюры лежат рядом).
AVATAR_DIR = Path(__file__).resolve().parent.parent / "media" / "avatars"
#: URL-префикс, под которым каталог отдаётся клиенту.
AVATAR_URL_PREFIX = "/media/avatars/"
#: Сторона миниатюры: 56px в списке с запасом на retina (2x) и аватар в шапке.
AVATAR_THUMB_SIZE = 128
#: Качество JPEG для миниатюры: на глаз не отличить, вес в разы меньше.
AVATAR_THUMB_QUALITY = 85


def make_avatar_thumb(content: bytes) -> tuple[bytes, str] | None:
    """Сжимает аватар до ``AVATAR_THUMB_SIZE``.

    Возвращает ``(байты, расширение)`` или ``None``, если файл не читается как
    изображение. Прозрачность сохраняем (PNG), остальное кладём в JPEG — иначе
    PNG-фото весит в разы больше при том же виде.
    """
    try:
        with Image.open(BytesIO(content)) as source:
            source.load()
            image = source.copy()
    except (UnidentifiedImageError, OSError, ValueError):
        return None

    image.thumbnail((AVATAR_THUMB_SIZE, AVATAR_THUMB_SIZE))

    has_alpha = image.mode in ("RGBA", "LA") or (
        image.mode == "P" and "transparency" in image.info
    )
    buffer = BytesIO()
    if has_alpha:
        image.convert("RGBA").save(buffer, "PNG", optimize=True)
        return buffer.getvalue(), "png"
    image.convert("RGB").save(
        buffer, "JPEG", quality=AVATAR_THUMB_QUALITY, optimize=True
    )
    return buffer.getvalue(), "jpg"


def thumb_stored_name(stored_name: str, extension: str) -> str:
    """Имя файла миниатюры: `user_5_ab.png` → `user_5_ab_t128.jpg`."""
    stem = stored_name.rsplit(".", 1)[0]
    return f"{stem}_t{AVATAR_THUMB_SIZE}.{extension}"


def store_avatar(
    content: bytes, *, prefix: str, extension: str
) -> tuple[str, str | None]:
    """Кладёт аватар и его миниатюру, возвращает `(url, url миниатюры)`.

    Миниатюры может не быть (файл не читается как изображение) — тогда второе
    значение `None`, и клиент покажет оригинал.
    """
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{prefix}_{uuid4().hex}.{extension}"
    # Пишем через media_crypto: при заданном AT_REST_KEY файлы на диске лежат
    # зашифрованными (миниатюра делается из открытых байт — они у нас в руках).
    write_file(AVATAR_DIR / stored_name, content)

    url = f"{AVATAR_URL_PREFIX}{stored_name}"
    thumb = make_avatar_thumb(content)
    if thumb is None:
        return url, None

    thumb_data, thumb_ext = thumb
    thumb_name = thumb_stored_name(stored_name, thumb_ext)
    write_file(AVATAR_DIR / thumb_name, thumb_data)
    return url, f"{AVATAR_URL_PREFIX}{thumb_name}"


def remove_avatar_files(*urls: str | None) -> None:
    """Удаляет файлы аватара и миниатюры (best-effort; чужие пути игнорируем)."""
    for url in urls:
        if not url or not url.startswith(AVATAR_URL_PREFIX):
            continue
        try:
            (AVATAR_DIR / Path(url).name).unlink(missing_ok=True)
        except OSError:
            pass


__all__ = (
    "AVATAR_DIR",
    "AVATAR_THUMB_SIZE",
    "make_avatar_thumb",
    "remove_avatar_files",
    "store_avatar",
    "thumb_stored_name",
)
