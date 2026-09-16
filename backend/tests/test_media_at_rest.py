"""Тесты шифрования файлов media «в покое» и раздачи их приложением.

Проверяем три вещи, каждая из которых ломает продукт по-своему:

* **шифрование** — файл на диске не должен содержать открытых байт (иначе защиты
  нет вовсе);
* **чтение** — расшифровка обязана возвращать байт-в-байт то, что записали;
  Range-запросы должны отдавать ровно запрошенный кусок, иначе у видео «поедет»
  картинка и перемотка;
* **совместимость** — файлы, загруженные до включения ключа, обязаны читаться как
  есть, а без ключа зашифрованные должны честно отвечать «недоступно», а не
  отдавать мусор.
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pytest
import pytest_asyncio
from cryptography.exceptions import InvalidTag
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from PIL import Image

from api_v1.media import views as media_views
from core import at_rest, avatar_store, media_crypto, media_store
from core.config import settings
from scripts import encrypt_media

KEY = bytes(range(32))
KEY_HEX = KEY.hex()
OTHER_KEY_HEX = bytes(range(32, 64)).hex()


@pytest.fixture
def with_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Включает шифрование файлов на время теста."""
    monkeypatch.setattr(settings, "at_rest_key", KEY_HEX)


@pytest.fixture
def without_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Шифрование выключено — поведение как до фичи."""
    monkeypatch.setattr(settings, "at_rest_key", None)


@pytest.fixture
def small_chunks(monkeypatch: pytest.MonkeyPatch) -> None:
    """Мелкие куски: на 1 МиБ те же границы проверять было бы в 1000 раз дольше."""
    monkeypatch.setattr(media_crypto, "CHUNK_BYTES", 8)
    monkeypatch.setattr(media_crypto, "CHUNK_FILE_BYTES", 8 + media_crypto.TAG_BYTES)


@pytest.fixture
def media_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Каталог media для роутера — временный, а не рабочий."""
    (tmp_path / "avatars").mkdir()
    monkeypatch.setattr(media_views, "MEDIA_DIR", tmp_path)
    return tmp_path


@pytest_asyncio.fixture
async def client(media_root: Path) -> AsyncClient:
    """Клиент к роутеру медиа: без БД, брокера и жизненного цикла приложения."""
    app = FastAPI()
    app.include_router(media_views.router, prefix="/media")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


def _jpeg_bytes(size: int = 40) -> bytes:
    """Маленькая картинка (для аватара): важно, что Pillow её читает."""
    image = Image.new("RGB", (size, size), (10, 20, 30))
    buffer = BytesIO()
    image.save(buffer, "JPEG")
    return buffer.getvalue()


# --- Контейнер: запись и чтение -----------------------------------------


def test_file_on_disk_has_no_plaintext(
    tmp_path: Path, with_key, small_chunks  # noqa: ANN001 - фикстуры
) -> None:
    """На диске лежит контейнер, а не исходные байты."""
    path = tmp_path / "photo.png"
    media_crypto.write_file(path, b"SUPER-SECRET-PHOTO")

    raw = path.read_bytes()
    assert raw.startswith(media_crypto.MAGIC)
    assert b"SUPER-SECRET" not in raw
    assert media_crypto.is_encrypted_file(path) is True
    assert media_crypto.plaintext_size(path) == len(b"SUPER-SECRET-PHOTO")
    assert media_crypto.read_file(path) == b"SUPER-SECRET-PHOTO"


@pytest.mark.parametrize("size", [0, 1, 7, 8, 9, 16, 17, 24])
def test_round_trip_at_chunk_boundaries(
    tmp_path: Path, with_key, small_chunks, size: int  # noqa: ANN001
) -> None:
    """Содержимое любой длины (в том числе кратной куску) читается обратно."""
    data = bytes(range(size))
    encrypted = media_crypto.encrypt_bytes(data)
    assert media_crypto.decrypt_bytes(encrypted) == data


def test_chunk_layout_is_predictable(with_key, small_chunks) -> None:  # noqa: ANN001
    """Куски лежат подряд и одного размера — на этом стоит расчёт Range."""
    data = bytes(20)  # 8 + 8 + 4 открытых байт → 3 куска
    encrypted = media_crypto.encrypt_bytes(data)
    expected = media_crypto.HEADER_BYTES + 2 * (8 + media_crypto.TAG_BYTES) + 4 + 16
    assert len(encrypted) == expected
    assert media_crypto.chunk_count(len(data)) == 3
    assert media_crypto.chunk_count(0) == 0


def test_without_key_encryption_is_transparent(
    tmp_path: Path, without_key
) -> None:  # noqa: ANN001
    """Без ключа пишем и читаем как раньше: фичу можно включать в любой момент."""
    path = tmp_path / "file.bin"
    media_crypto.write_file(path, b"plain")
    assert media_crypto.is_encrypted_file(path) is False
    assert path.read_bytes() == b"plain"
    assert media_crypto.plaintext_size(path) == 5
    assert media_crypto.read_file(path) == b"plain"


def test_already_encrypted_is_not_encrypted_twice(
    with_key, small_chunks
) -> None:  # noqa: ANN001
    """Повторная обработка (скрипт перешифровки) не портит контейнер."""
    encrypted = media_crypto.encrypt_bytes(b"data")
    assert media_crypto.encrypt_bytes(encrypted) == encrypted


def test_wrong_key_does_not_silently_return_garbage(
    with_key, monkeypatch
) -> None:  # noqa: ANN001
    """Чужим ключом содержимое не читается — это ошибка, а не «почти верные» байты."""
    encrypted = media_crypto.encrypt_bytes(b"secret")
    monkeypatch.setattr(settings, "at_rest_key", OTHER_KEY_HEX)
    with pytest.raises(InvalidTag):
        media_crypto.decrypt_bytes(encrypted)


def test_encrypted_file_without_key_reports_problem(
    tmp_path: Path, with_key, monkeypatch
) -> None:  # noqa: ANN001
    """Ключ потерян — понятная ошибка вместо мусора в ответе."""
    path = tmp_path / "file.bin"
    media_crypto.write_file(path, b"secret")
    monkeypatch.setattr(settings, "at_rest_key", None)

    assert media_crypto.is_enabled() is False
    with pytest.raises(media_crypto.MediaKeyMissing):
        next(media_crypto.iter_plaintext(path))


@pytest.mark.parametrize(
    ("start", "end"),
    [(0, 5), (3, 9), (7, 8), (8, 16), (0, 20), (19, 20), (0, 0)],
)
def test_iter_plaintext_returns_exact_slice(
    tmp_path: Path, with_key, small_chunks, start: int, end: int  # noqa: ANN001
) -> None:
    """Диапазон отдаётся ровно тот, что просили (на этом стоит перемотка)."""
    data = bytes(range(20))
    path = tmp_path / "video.mp4"
    media_crypto.write_file(path, data)

    assert b"".join(media_crypto.iter_plaintext(path, start, end)) == data[start:end]


def test_iter_plaintext_clamps_range_past_end(
    tmp_path: Path, with_key, small_chunks  # noqa: ANN001
) -> None:
    """Запрос «до конца файла» не читает то, чего нет."""
    path = tmp_path / "video.mp4"
    media_crypto.write_file(path, b"abcdef")

    assert b"".join(media_crypto.iter_plaintext(path, 3, 1000)) == b"def"


def test_iter_plaintext_reads_unencrypted_file(
    tmp_path: Path, without_key
) -> None:  # noqa: ANN001
    """Старые (до включения ключа) файлы отдаются как есть."""
    path = tmp_path / "old.png"
    path.write_bytes(b"old-bytes")

    assert b"".join(media_crypto.iter_plaintext(path)) == b"old-bytes"
    assert b"".join(media_crypto.iter_plaintext(path, 4, 9)) == b"bytes"


def test_plaintext_size_of_broken_container(
    tmp_path: Path, with_key
) -> None:  # noqa: ANN001
    """Обрезанный заголовок — явная ошибка, а не «размер 0»."""
    path = tmp_path / "broken.bin"
    path.write_bytes(media_crypto.MAGIC)

    with pytest.raises(ValueError):
        media_crypto.plaintext_size(path)


# --- Запись файлов приложением ------------------------------------------


def test_store_media_writes_encrypted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, with_key  # noqa: ANN001
) -> None:
    """Вложения пишутся на диск зашифрованными."""
    monkeypatch.setattr(media_store, "MEDIA_DIR", tmp_path)
    url = media_store.store_media(b"secret-attachment", ".png")

    assert url.startswith("/media/")
    path = tmp_path / url.rsplit("/", 1)[-1]
    assert media_crypto.is_encrypted_file(path) is True
    assert media_crypto.read_file(path) == b"secret-attachment"


def test_store_avatar_encrypts_original_and_thumb(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, with_key  # noqa: ANN001
) -> None:
    """Аватар и миниатюра тоже шифруются (иначе текст «утекает» картинкой)."""
    monkeypatch.setattr(avatar_store, "AVATAR_DIR", tmp_path)
    url, thumb_url = avatar_store.store_avatar(
        _jpeg_bytes(), prefix="user_7", extension="jpg"
    )
    assert thumb_url is not None

    for value in (url, thumb_url):
        path = tmp_path / value.rsplit("/", 1)[-1]
        assert media_crypto.is_encrypted_file(path) is True
        # Миниатюра читается Pillow уже после расшифровки.
        with Image.open(BytesIO(media_crypto.read_file(path))) as image:
            assert image.size[0] > 0


# --- Перешифровка истории ------------------------------------------------


def test_backfill_encrypts_files_and_is_idempotent(
    tmp_path: Path, with_key  # noqa: ANN001
) -> None:
    """Скрипт шифрует и файлы вложений, и аватары; повторный запуск — пустой."""
    (tmp_path / "a.png").write_bytes(b"AAAA")
    (tmp_path / "avatars").mkdir()
    (tmp_path / "avatars" / "u.jpg").write_bytes(b"BBBB")
    # Временные файлы не трогаем: они появляются на миг при записи.
    (tmp_path / ".a.png.tmp").write_bytes(b"tmp")

    files = encrypt_media.pending_files(tmp_path)
    assert {path.name for path in files} == {"a.png", "u.jpg"}
    for path in files:
        encrypt_media.encrypt_file(path)

    assert encrypt_media.pending_files(tmp_path) == []
    assert media_crypto.read_file(tmp_path / "a.png") == b"AAAA"
    assert media_crypto.read_file(tmp_path / "avatars" / "u.jpg") == b"BBBB"


def test_backfill_keeps_original_when_write_fails(
    tmp_path: Path, with_key, monkeypatch: pytest.MonkeyPatch  # noqa: ANN001
) -> None:
    """Сбой записи не портит файл: он читается и снова попадёт в очередь."""
    path = tmp_path / "busy.png"
    path.write_bytes(b"GOOD")

    def failing_write(target: Path, data: bytes) -> None:
        raise OSError("файл занят")

    monkeypatch.setattr(media_crypto, "write_file", failing_write)
    with pytest.raises(OSError):
        encrypt_media.encrypt_file(path)

    monkeypatch.undo()
    assert media_crypto.read_file(path) == b"GOOD"
    assert encrypt_media.pending_files(tmp_path) == [path]


# --- Раздача через приложение -------------------------------------------


async def test_serves_encrypted_file_with_headers(
    client: AsyncClient, media_root: Path, with_key, small_chunks  # noqa: ANN001
) -> None:
    """Файл отдаётся целиком, с длиной, типом и поддержкой Range."""
    data = b"\x89PNG-secret-body"
    media_crypto.write_file(media_root / "pic.png", data)

    response = await client.get("/media/pic.png")

    assert response.status_code == 200
    assert response.content == data
    assert response.headers["content-length"] == str(len(data))
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["content-type"] == "image/png"
    assert "etag" in response.headers


async def test_range_request_returns_part(
    client: AsyncClient, media_root: Path, with_key, small_chunks  # noqa: ANN001
) -> None:
    """206 с ровно запрошенным куском — иначе видео не перематывается."""
    data = bytes(range(20))
    media_crypto.write_file(media_root / "clip.mp4", data)

    response = await client.get("/media/clip.mp4", headers={"Range": "bytes=5-12"})

    assert response.status_code == 206
    assert response.content == data[5:13]
    assert response.headers["content-range"] == f"bytes 5-12/{len(data)}"
    assert response.headers["content-length"] == "8"


async def test_suffix_range_returns_tail(
    client: AsyncClient, media_root: Path, with_key, small_chunks  # noqa: ANN001
) -> None:
    """Запрос «последние N байт» тоже работает (докачка файла)."""
    data = b"0123456789"
    media_crypto.write_file(media_root / "clip.mp4", data)

    response = await client.get("/media/clip.mp4", headers={"Range": "bytes=-3"})

    assert response.status_code == 206
    assert response.content == b"789"


async def test_unsatisfiable_range_is_416(
    client: AsyncClient, media_root: Path, with_key  # noqa: ANN001
) -> None:
    """Диапазон за пределами файла — 416 с указанием полного размера."""
    media_crypto.write_file(media_root / "clip.mp4", b"0123")

    response = await client.get("/media/clip.mp4", headers={"Range": "bytes=99-"})

    assert response.status_code == 416
    assert response.headers["content-range"] == "bytes */4"


async def test_multi_range_falls_back_to_full_file(
    client: AsyncClient, media_root: Path, with_key  # noqa: ANN001
) -> None:
    """Несколько диапазонов не поддерживаем — отдаём файл целиком (как разрешено)."""
    media_crypto.write_file(media_root / "clip.mp4", b"0123456789")

    response = await client.get("/media/clip.mp4", headers={"Range": "bytes=0-1,4-5"})

    assert response.status_code == 200
    assert response.content == b"0123456789"


async def test_head_request_has_no_body(
    client: AsyncClient, media_root: Path, with_key  # noqa: ANN001
) -> None:
    """HEAD отдаёт заголовки без содержимого (проверка размера и типа)."""
    media_crypto.write_file(media_root / "clip.mp4", b"0123456789")

    response = await client.head("/media/clip.mp4")

    assert response.status_code == 200
    assert response.content == b""
    assert response.headers["content-length"] == "10"


async def test_conditional_request_returns_304(
    client: AsyncClient, media_root: Path, with_key  # noqa: ANN001
) -> None:
    """Свежий файл у клиента — 304: не расшифровываем и не гоняем байты зря."""
    media_crypto.write_file(media_root / "pic.png", b"0123456789")
    first = await client.get("/media/pic.png")

    response = await client.get(
        "/media/pic.png", headers={"If-None-Match": first.headers["etag"]}
    )

    assert response.status_code == 304
    assert response.content == b""


async def test_if_range_mismatch_serves_full_file(
    client: AsyncClient, media_root: Path, with_key  # noqa: ANN001
) -> None:
    """Если файл изменился, диапазон не применяем: клиент получит файл целиком."""
    media_crypto.write_file(media_root / "clip.mp4", b"0123456789")

    response = await client.get(
        "/media/clip.mp4",
        headers={"Range": "bytes=2-4", "If-Range": '"old-etag"'},
    )

    assert response.status_code == 200
    assert response.content == b"0123456789"


async def test_legacy_plain_file_is_served(
    client: AsyncClient, media_root: Path, with_key  # noqa: ANN001
) -> None:
    """Файлы, загруженные до включения ключа, отдаются как есть."""
    (media_root / "avatars" / "old.png").write_bytes(b"old-avatar")

    response = await client.get("/media/avatars/old.png")

    assert response.status_code == 200
    assert response.content == b"old-avatar"


async def test_encrypted_file_without_key_is_503(
    client: AsyncClient, media_root: Path, with_key, monkeypatch  # noqa: ANN001
) -> None:
    """Без ключа честнее сказать «недоступно», чем отдать шифротекст."""
    media_crypto.write_file(media_root / "pic.png", b"secret")
    monkeypatch.setattr(settings, "at_rest_key", None)

    response = await client.get("/media/pic.png")

    assert response.status_code == 503


async def test_corrupted_container_is_error(
    client: AsyncClient, media_root: Path, with_key  # noqa: ANN001
) -> None:
    """Битый файл — 500, а не «пустая картинка» с кодом 200."""
    (media_root / "broken.png").write_bytes(media_crypto.MAGIC + b"\x00")

    response = await client.get("/media/broken.png")

    assert response.status_code == 500


async def test_missing_file_is_404(client: AsyncClient) -> None:
    """Нет файла — 404."""
    response = await client.get("/media/nope.png")
    assert response.status_code == 404


@pytest.mark.parametrize(
    "path",
    ["/media/../secret.txt", "/media/%2e%2e/secret.txt", "/media/../"],
)
async def test_path_traversal_is_blocked(
    client: AsyncClient, media_root: Path, path: str
) -> None:
    """Имя приходит из URL: за пределы каталога выйти нельзя."""
    (media_root.parent / "secret.txt").write_bytes(b"secret")

    response = await client.get(path)

    assert response.status_code in (404, 405)


@pytest.mark.parametrize("extension", ["html", "svg"])
async def test_dangerous_types_are_not_served_as_document(
    client: AsyncClient, media_root: Path, with_key, extension: str  # noqa: ANN001
) -> None:
    """Под «активным» расширением файл отдаём потоком байт (защита от XSS)."""
    media_crypto.write_file(media_root / f"file.{extension}", b"<html>")

    response = await client.get(f"/media/file.{extension}")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/octet-stream"


async def test_unknown_extension_is_octet_stream(
    client: AsyncClient, media_root: Path, with_key  # noqa: ANN001
) -> None:
    """Неизвестное расширение — тоже поток байт."""
    media_crypto.write_file(media_root / "file.zzz", b"data")

    response = await client.get("/media/file.zzz")

    assert response.headers["content-type"] == "application/octet-stream"


async def test_range_response_matches_plaintext_when_chunks_are_real(
    client: AsyncClient, media_root: Path, with_key, monkeypatch  # noqa: ANN001
) -> None:
    """На «настоящем» размере куска (1 МиБ) диапазон через границу читается верно."""
    monkeypatch.setattr(media_crypto, "CHUNK_BYTES", 1024)
    monkeypatch.setattr(media_crypto, "CHUNK_FILE_BYTES", 1024 + media_crypto.TAG_BYTES)
    data = bytes(range(256)) * 12  # 3072 байта — ровно 3 куска
    media_crypto.write_file(media_root / "big.mp4", data)

    response = await client.get("/media/big.mp4", headers={"Range": "bytes=1000-1100"})

    assert response.status_code == 206
    assert response.content == data[1000:1101]


def test_is_encrypted_file_tolerates_missing_file(tmp_path: Path) -> None:
    """Удалённый файл (чистка «сирот») не должен валить проверку."""
    assert media_crypto.is_encrypted_file(tmp_path / "gone.bin") is False


def test_key_missing_error_is_clear(with_key, monkeypatch) -> None:  # noqa: ANN001
    """В сообщении об ошибке — что именно не задано (для дежурного)."""
    media_crypto.encrypt_bytes(b"x")
    monkeypatch.setattr(settings, "at_rest_key", None)
    assert at_rest.is_enabled() is False
    with pytest.raises(media_crypto.MediaKeyMissing, match="AT_REST_KEY"):
        media_crypto._require_key()
