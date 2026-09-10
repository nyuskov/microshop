"""Запись файлов в общий каталог ``media``.

Каталог раздаёт nginx (префикс ``/media/``), а ссылки хранятся в БД: у вложений
сообщений — в полях ``file_*``, у историй — в ``media_*``. Общая точка нужна,
чтобы правило «как именуем файл» было одно: имя — это uuid, то есть содержимое
нельзя угадать по ссылке.
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

MEDIA_DIR = Path(__file__).resolve().parent.parent / "media"


def store_media(content: bytes, suffix: str = "") -> str:
    """Сохраняет файл в media-каталог и возвращает относительный URL.

    ``suffix`` — расширение вместе с точкой (``.jpg``). У загрузок оно берётся из
    имени файла, у GIF из очереди (``tasks.media_tasks``) известно заранее.
    """
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid4().hex}{suffix.lower()}"
    (MEDIA_DIR / stored_name).write_bytes(content)
    return f"/media/{stored_name}"
