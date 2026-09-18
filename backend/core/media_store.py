"""Запись файлов в общий каталог ``media``.

Каталог отдаёт приложение (префикс ``/media/``, см. ``api_v1/media/views.py``)
— иначе файлы нельзя было бы держать на диске зашифрованными: чтобы расшифровать
их для клиента, нужен код, а nginx умеет отдавать только как есть. Ссылки при
этом хранятся в БД: у вложений сообщений — в полях ``file_*``, у историй — в
``media_*``. Общая точка нужна, чтобы правило «как именуем файл» было одно: имя —
это uuid, то есть содержимое нельзя угадать по ссылке.
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from core.media_crypto import write_file

MEDIA_DIR = Path(__file__).resolve().parent.parent / "media"

#: Префикс имени файла одноразового вложения («посмотреть один раз»).
#: По нему раздача медиа понимает, что файл нужно проверить в БД и выдать
#: один раз, — иначе на каждый запрос картинки ходили бы в базу.
VIEW_ONCE_PREFIX = "vo_"


def store_media(content: bytes, suffix: str = "", prefix: str = "") -> str:
    """Сохраняет файл в media-каталог и возвращает относительный URL.

    ``suffix`` — расширение вместе с точкой (``.jpg``). У загрузок оно берётся из
    имени файла, у GIF из очереди (``tasks.media_tasks``) известно заранее.

    Файл уходит на диск зашифрованным, если задан ``AT_REST_KEY`` (см.
    ``core/media_crypto.py``); без ключа — как раньше, открытым.
    """
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{prefix}{uuid4().hex}{suffix.lower()}"
    write_file(MEDIA_DIR / stored_name, content)
    return f"/media/{stored_name}"


def remove_media(url: str | None) -> None:
    """Удаляет файл media по его URL (``/media/<имя>``).

    Нужно одноразовым вложениям: после первого просмотра блоб стирается, и
    повторно его не отдаст уже никто — ни через API, ни напрямую с диска.
    Отсутствие файла — не ошибка: его могла убрать чистка «сирот».
    """
    if not url:
        return
    (MEDIA_DIR / Path(url).name).unlink(missing_ok=True)
