"""Юнит-тесты валидации загрузок (без БД и сети)."""

import pytest
from fastapi import HTTPException

from api_v1.upload_guard import (
    detect_image_magic,
    validate_attachment_upload,
    validate_image_upload,
)

PNG_HEADER = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
JPEG_HEADER = b"\xff\xd8\xff\xe0" + b"\x00" * 16
GIF_HEADER = b"GIF89a" + b"\x00" * 16
HTML_BODY = b"<html><script>alert(1)</script></html>"


def test_detect_image_magic() -> None:
    assert detect_image_magic(PNG_HEADER) == "png"
    assert detect_image_magic(JPEG_HEADER) == "jpg"
    assert detect_image_magic(GIF_HEADER) == "gif"
    assert detect_image_magic(HTML_BODY) is None


def test_valid_png_attachment_ok() -> None:
    # Не должно бросать исключение.
    validate_attachment_upload("photo.png", PNG_HEADER)


def test_dangerous_extensions_rejected() -> None:
    for name in ("page.html", "img.svg", "script.js", "data.xml", "app.xhtml"):
        with pytest.raises(HTTPException):
            validate_attachment_upload(name, b"whatever")


def test_unknown_extension_rejected() -> None:
    with pytest.raises(HTTPException):
        validate_attachment_upload("setup.exe", b"MZ\x90\x00")


def test_spoofed_image_content_rejected() -> None:
    # Расширение «.png», но содержимое — HTML.
    with pytest.raises(HTTPException):
        validate_attachment_upload("photo.png", HTML_BODY)


def test_validate_image_upload() -> None:
    validate_image_upload("avatar.png", PNG_HEADER)
    with pytest.raises(HTTPException):
        validate_image_upload("avatar.png", HTML_BODY)
    with pytest.raises(HTTPException):
        validate_image_upload("avatar.pdf", PNG_HEADER)
