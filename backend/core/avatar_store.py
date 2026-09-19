"""Аватары: маленькие копии файла для списков, шапок и уведомлений.

Зачем: аватар показывается кружком 40–56px, а в хранилище лежит то, что
загрузили с телефона — часто несколько мегабайт. Список чатов тянет аватар на
каждую строку, поэтому для списков отдаём отдельную миниатюру: она меньше
оригинала в десятки раз, а на экране неотличима.

Вторая копия — «иконка уведомления»: та же картинка чуть меньше и с прозрачными
полями. Размер крупной картинки в push-уведомлении задаёт система, поэтому
уменьшить аватар можно только полями (см. ``make_push_icon``).

Pillow может не открыть файл (битый или необычный формат) — это не повод ломать
загрузку: копий просто не будет, а клиент покажет оригинал (см.
``avatar_thumb_url`` в схемах).

Файлы пишутся через ``core.media_crypto``: при заданном ``AT_REST_KEY`` на диске
лежат зашифрованными (иначе шифрование текстов сообщений обходилось бы картинкой
с тем же содержимым).
"""

from io import BytesIO
from pathlib import Path
from uuid import uuid4

from PIL import Image, UnidentifiedImageError

from core.media_crypto import read_file, write_file

#: Каталог аватаров (оригиналы и миниатюры лежат рядом).
AVATAR_DIR = Path(__file__).resolve().parent.parent / "media" / "avatars"
#: URL-префикс, под которым каталог отдаётся клиенту.
AVATAR_URL_PREFIX = "/media/avatars/"
#: Сторона миниатюры: 56px в списке с запасом на retina (2x) и аватар в шапке.
AVATAR_THUMB_SIZE = 128
#: Качество JPEG для миниатюры: на глаз не отличить, вес в разы меньше.
AVATAR_THUMB_QUALITY = 85
#: Сторона иконки уведомления. Система показывает её крупной картинкой в
#: уведомлении (Android — плитка ~64dp), поэтому 192px хватает с запасом на 3x.
PUSH_ICON_SIZE = 192
#: Какую долю иконки занимает сам аватар; остальное — прозрачные поля.
PUSH_ICON_INNER_RATIO = 0.7


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


def make_push_icon(content: bytes) -> bytes | None:
    """Делает «иконку уведомления»: аватар чуть меньше, с прозрачными полями.

    Зачем поля: размер крупной картинки в уведомлении задаёт система, изменить
    его со стороны приложения нельзя (в Web Push нет ни размера, ни «мелкого»
    варианта картинки). Единственный способ показать аватар компактнее — оставить
    вокруг него прозрачную рамку: на экране видно сам кружок, а не картинку во
    всю плитку.

    Возвращает PNG (прозрачность — суть приёма) или ``None``, если файл не
    читается как изображение.
    """
    try:
        with Image.open(BytesIO(content)) as source:
            source.load()
            image = source.convert("RGBA")
    except (UnidentifiedImageError, OSError, ValueError):
        return None

    inner = max(1, round(PUSH_ICON_SIZE * PUSH_ICON_INNER_RATIO))
    image.thumbnail((inner, inner))
    canvas = Image.new("RGBA", (PUSH_ICON_SIZE, PUSH_ICON_SIZE), (0, 0, 0, 0))
    canvas.paste(
        image,
        ((PUSH_ICON_SIZE - image.width) // 2, (PUSH_ICON_SIZE - image.height) // 2),
    )
    buffer = BytesIO()
    canvas.save(buffer, "PNG", optimize=True)
    return buffer.getvalue()


def push_icon_stored_name(stored_name: str) -> str:
    """Имя иконки уведомления: `user_5_ab.png` → `user_5_ab_n192.png`.

    Принимает и имя миниатюры (`user_5_ab_t128.jpg`): её суффикс снимаем, иначе
    от одного аватара получались бы разные имена иконки.
    """
    stem = stored_name.rsplit(".", 1)[0]
    thumb_suffix = f"_t{AVATAR_THUMB_SIZE}"
    if stem.endswith(thumb_suffix):
        stem = stem[: -len(thumb_suffix)]
    return f"{stem}_n{PUSH_ICON_SIZE}.png"


def push_icon_url(*urls: str | None) -> str | None:
    """URL иконки уведомления для аватара; ``None`` — сделать не удалось.

    Сначала ищем готовый файл, иначе делаем иконку из первого доступного файла
    (оригинал, потом миниатюра): первое уведомление будет чуть медленнее, а
    дальше отдаётся готовый файл. Аватар мог быть загружен ДО появления иконок,
    поэтому генерация на месте — не «одноразовая миграция», а страховка.
    """
    avatars = [
        url.strip() for url in urls if url and url.strip().startswith(AVATAR_URL_PREFIX)
    ]
    if not avatars:
        return None

    names = [push_icon_stored_name(Path(url).name) for url in avatars]
    for name in names:
        if (AVATAR_DIR / name).is_file():
            return f"{AVATAR_URL_PREFIX}{name}"

    for url, name in zip(avatars, names):
        source = AVATAR_DIR / Path(url).name
        if not source.is_file():
            continue
        try:
            icon = make_push_icon(read_file(source))
        except OSError:
            continue
        if icon is None:
            continue
        try:
            write_file(AVATAR_DIR / name, icon)
        except OSError:
            # Записать не вышло (права, диск) — покажем аватар как раньше:
            # уведомление без картинки хуже, чем уведомление с крупной.
            continue
        return f"{AVATAR_URL_PREFIX}{name}"

    return None


def store_avatar(
    content: bytes, *, prefix: str, extension: str
) -> tuple[str, str | None]:
    """Кладёт аватар, его миниатюру и иконку уведомления.

    Возвращает `(url, url миниатюры)`. Миниатюры может не быть (файл не читается
    как изображение) — тогда второе значение `None`, и клиент покажет оригинал.
    Иконка уведомления в БД не хранится: её адрес выводится из имени аватара
    (см. ``push_icon_url``), поэтому здесь её просто пишем рядом.
    """
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{prefix}_{uuid4().hex}.{extension}"
    # Пишем через media_crypto: при заданном AT_REST_KEY файлы на диске лежат
    # зашифрованными (миниатюра делается из открытых байт — они у нас в руках).
    write_file(AVATAR_DIR / stored_name, content)

    url = f"{AVATAR_URL_PREFIX}{stored_name}"

    # Иконка уведомления: делаем сразу, чтобы первое уведомление не ждало
    # генерации (в пуше она отдаётся крупной картинкой).
    icon = make_push_icon(content)
    if icon is not None:
        write_file(AVATAR_DIR / push_icon_stored_name(stored_name), icon)

    thumb = make_avatar_thumb(content)
    if thumb is None:
        return url, None

    thumb_data, thumb_ext = thumb
    thumb_name = thumb_stored_name(stored_name, thumb_ext)
    write_file(AVATAR_DIR / thumb_name, thumb_data)
    return url, f"{AVATAR_URL_PREFIX}{thumb_name}"


def remove_avatar_files(*urls: str | None) -> None:
    """Удаляет аватар, миниатюру и иконку уведомления (best-effort).

    Иконка уведомления выводится из имени аватара, поэтому удаляем и её: иначе
    файл остался бы на диске и в него же попал бы следующий аватар того же
    пользователя (имя содержит случайный hex, совпадение маловероятно, но мусор
    копиться не должен).
    """
    for url in urls:
        if not url or not url.startswith(AVATAR_URL_PREFIX):
            continue
        name = Path(url).name
        for candidate in {name, push_icon_stored_name(name)}:
            try:
                (AVATAR_DIR / candidate).unlink(missing_ok=True)
            except OSError:
                pass


__all__ = (
    "AVATAR_DIR",
    "AVATAR_THUMB_SIZE",
    "PUSH_ICON_SIZE",
    "make_avatar_thumb",
    "make_push_icon",
    "push_icon_stored_name",
    "push_icon_url",
    "remove_avatar_files",
    "store_avatar",
    "thumb_stored_name",
)
