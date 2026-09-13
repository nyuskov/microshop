"""Валидация загружаемых файлов: расширение + сигнатуры (magic bytes).

Защита от двух проблем:

1. Сохранения «активного» контента (HTML/SVG/XML/JS) под расширением, которое
   StaticFiles отдаёт браузеру как HTML — при открытии ``/media/...`` напрямую это
   потенциальный stored-XSS. Поэтому используется белый список расширений,
   а остальные (в т.ч. html/svg/xml/js) отклоняются намеренно.
2. Несоответствия реального формата заявленному расширению для изображений
   (например, «.png», внутри которого HTML).
"""

from pathlib import Path

from fastapi import HTTPException, status

# Расширения, которые безопасно хранить и отдавать браузеру.
SAFE_IMAGE_EXTS = {"png", "jpg", "jpeg", "gif", "webp", "bmp"}
SAFE_MEDIA_EXTS = {
    "mp4",
    "webm",
    "mov",
    "m4a",
    "mp3",
    "ogg",
    "opus",
    "wav",
    "aac",
}
SAFE_DOC_EXTS = {
    "pdf",
    "txt",
    "md",
    "csv",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "zip",
    "rar",
    "7z",
}

# Всё, что можно приложить к сообщению.
ALLOWED_ATTACHMENT_EXTS = SAFE_IMAGE_EXTS | SAFE_MEDIA_EXTS | SAFE_DOC_EXTS


def normalize_ext(filename: str) -> str:
    """Возвращает расширение файла в нижнем регистре без точки ('' если нет)."""
    return Path(filename).suffix.lower().lstrip(".")


def detect_image_magic(content: bytes) -> str | None:
    """Определяет тип изображения по первым байтам (или None)."""
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if content[:3] == b"\xff\xd8\xff":
        return "jpg"
    if content[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "webp"
    if content[:2] == b"BM":
        return "bmp"
    return None


def _raise_ext() -> None:
    raise HTTPException(
        status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        detail="Недопустимый тип файла",
    )


def validate_image_upload(filename: str, content: bytes) -> None:
    """Проверяет файл изображения (для аватара): расширение + сигнатура."""
    ext = normalize_ext(filename)
    if ext not in SAFE_IMAGE_EXTS:
        _raise_ext()
    if detect_image_magic(content) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Содержимое файла не похоже на изображение",
        )


def validate_attachment_upload(filename: str, content: bytes) -> None:
    """Проверяет вложение сообщения: расширение из белого списка + сигнатура."""
    ext = normalize_ext(filename)
    if not ext or ext not in ALLOWED_ATTACHMENT_EXTS:
        _raise_ext()
    if ext in SAFE_IMAGE_EXTS and detect_image_magic(content) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Содержимое файла не похоже на изображение",
        )
