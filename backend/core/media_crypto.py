"""Шифрование файлов media «в покое» (см. core/at_rest.py).

Зачем: вложения, аватары, истории и картинки предпросмотра лежат на диске
открытыми. Диск, снапшот или случайная копия каталога ``media`` — и вся переписка
в картинках/видео читается целиком. Здесь та же идея, что и у текстов сообщений:
ключ ``AT_REST_KEY`` живёт в окружении (не в дампе), без него файлы не прочитать.

Почему формат не «шифруем файл целиком», а контейнер из кусков:

* файлы бывают большими (видео на сотни мегабайт) — целиком в память не влезут;
* браузеру нужны HTTP Range-запросы: без них не работает перемотка видео и
  докачка. Зная, что куски одного размера и лежат подряд, можно расшифровать
  только нужные, а не весь файл.

Формат файла (``encf:v2``, текущий)::

    0   8   magic «encf:v2:»
    8   8   номер ключа (первые 8 hex-символов SHA-256 ключа)
    16  8   размер содержимого (uint64, big-endian)
    24  12  базовый nonce
    36  ... куски: для каждого — AES-256-GCM(ciphertext||tag)

Старый формат ``encf:v1`` был тем же, но без номера ключа (заголовок 28 байт).
Такие файлы читаются перебором известных ключей (текущий и ``AT_REST_KEY_PREVIOUS``,
см. ``docs/at-rest-rotation.md``), а при ротации перешифровываются скриптом
``scripts/encrypt_media.py --rotate``.

Кусок i шифруется nonce'ом «базовый nonce без последних 4 байт + номер куска».
Кусок занимает ``len(открытых данных) + 16`` байт, открытых данных — не больше
``CHUNK_BYTES``, поэтому позиция любого байта в файле считается арифметикой:
``offset = заголовок + (позиция // CHUNK_BYTES) * (CHUNK_BYTES + 16)``.

Ключа нет — функции работают «насквозь» (пишем и читаем как раньше), поэтому
включать шифрование можно в любой момент и на живой базе: старые файлы читаются
как есть, новые пишутся зашифрованными, а перешифровать историю — скриптом
``scripts/encrypt_media.py``.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from core import at_rest

logger = logging.getLogger(__name__)

#: Признаки контейнера в начале файла: старая версия (без номера ключа) и текущая.
MAGIC_V1 = b"encf:v1:"
MAGIC_V2 = b"encf:v2:"
MAGIC = MAGIC_V2

#: Заголовок версии 1: magic (8) + размер содержимого (8) + базовый nonce (12).
HEADER_V1_BYTES = 28

#: Заголовок текущей версии: magic (8) + номер ключа (8) + размер (8) + nonce (12).
HEADER_BYTES = 36

#: Сколько символов отпечатка ключа пишем в заголовок (`core.at_rest.key_id`).
KEY_ID_CHARS = at_rest.KEY_ID_CHARS

#: Размер тега GCM (он дописывается к каждому куску).
TAG_BYTES = 16

#: Сколько открытых данных шифруем одним куском. Меньше — точнее Range-запросы,
#: больше — меньше накладных расходов; мегабайт — привычный размер для медиа.
CHUNK_BYTES = 1024 * 1024

#: Размер куска на диске: шифротекст плюс тег.
CHUNK_FILE_BYTES = CHUNK_BYTES + TAG_BYTES

#: Сколько отдаём за одно чтение при потоковой выдаче.
STREAM_BYTES = 64 * 1024


class MediaKeyMissing(RuntimeError):
    """Файл зашифрован, а ключа нет — отдать содержимое нечем."""


def is_enabled() -> bool:
    """Включено ли шифрование файлов (задан корректный ключ)."""
    return at_rest.is_enabled()


def is_encrypted_bytes(data: bytes) -> bool:
    """Начинается ли содержимое с нашего заголовка (любой версии)."""
    return data.startswith(MAGIC_V1) or data.startswith(MAGIC_V2)


def is_encrypted_file(path: str | Path) -> bool:
    """Зашифрован ли файл на диске (нет файла — считаем, что нет)."""
    return _magic(path) is not None


def encrypted_with_current_key(path: str | Path) -> bool:
    """Записан ли файл текущим ключом.

    Для старого формата (`encf:v1:`) ответ всегда «нет»: номера ключа в нём нет,
    поэтому при ротации такие файлы нужно перешифровать (см. `--rotate`).
    """
    magic = _magic(path)
    if magic != MAGIC_V2:
        return False
    current = at_rest.encryption_key()
    if current is None:
        return False
    return _key_id_of(path) == at_rest.key_id(current)


def _magic(path: str | Path) -> bytes | None:
    """Версия контейнера по первым байтам (None — файл не наш)."""
    try:
        with Path(path).open("rb") as file:
            head = file.read(len(MAGIC_V2))
    except OSError:
        return None
    for magic in (MAGIC_V2, MAGIC_V1):
        if head.startswith(magic):
            return magic
    return None


def _key_id_of(path: str | Path) -> str | None:
    """Номер ключа из заголовка (None — файл не в текущем формате)."""
    with Path(path).open("rb") as file:
        head = file.read(HEADER_BYTES)
    if not head.startswith(MAGIC_V2):
        return None
    start = len(MAGIC_V2)
    return head[start : start + KEY_ID_CHARS].decode("ascii", "replace")


@dataclass(frozen=True)
class Header:
    """Заголовок контейнера (разбор версии и метаданных)."""

    #: Номер ключа (``None`` у старого формата, где его нет).
    key_id: str | None
    #: Размер открытого содержимого.
    plain_size: int
    #: Базовый nonce, из которого считаются nonce'ы кусков.
    base_nonce: bytes
    #: Размер заголовка на диске (у версий он разный).
    header_bytes: int


def _parse_header(head: bytes) -> Header:
    """Разбирает заголовок контейнера: текущий формат или старый."""
    if head.startswith(MAGIC_V2):
        id_start = len(MAGIC_V2)
        size_start = id_start + KEY_ID_CHARS
        nonce_start = size_start + 8
        return Header(
            key_id=head[id_start:size_start].decode("ascii", "replace"),
            plain_size=int.from_bytes(head[size_start:nonce_start], "big"),
            base_nonce=head[nonce_start:HEADER_BYTES],
            header_bytes=HEADER_BYTES,
        )
    if head.startswith(MAGIC_V1):
        size_start = len(MAGIC_V1)
        nonce_start = size_start + 8
        return Header(
            key_id=None,
            plain_size=int.from_bytes(head[size_start:nonce_start], "big"),
            base_nonce=head[nonce_start:HEADER_V1_BYTES],
            header_bytes=HEADER_V1_BYTES,
        )
    raise ValueError("Файл не в нашем контейнере")


def read_header(path: str | Path) -> Header:
    """Заголовок файла на диске (ошибка, если файл не зашифрован)."""
    magic = _magic(path)
    if magic is None:
        raise ValueError("Файл не зашифрован")
    size = HEADER_BYTES if magic == MAGIC_V2 else HEADER_V1_BYTES
    with Path(path).open("rb") as file:
        head = file.read(size)
    if len(head) < size:
        raise ValueError("Повреждённый контейнер media")
    return _parse_header(head)


def _keys_for(identifier: str | None) -> list[bytes]:
    """Ключи для расшифровки в порядке проверки.

    Сначала тот, чей номер записан в контейнере (обычный случай), затем
    остальные — так читается и то, что записано прошлым ключом, и старый формат
    без номера.
    """
    known = at_rest.decryption_keys()
    if not known:
        raise MediaKeyMissing("Ключ at-rest не задан — зашифрованный файл не прочитать")
    ordered = [key for current_id, key in known if current_id == identifier]
    ordered += [key for current_id, key in known if current_id != identifier]
    return ordered


def _chunk_nonce(base: bytes, index: int) -> bytes:
    """Nonce куска: базовый без последних 4 байт плюс номер куска."""
    return base[: at_rest.NONCE_BYTES - 4] + index.to_bytes(4, "big")


def chunk_count(plain_size: int) -> int:
    """Сколько кусков занимает содержимое такого размера."""
    if plain_size <= 0:
        return 0
    return (plain_size + CHUNK_BYTES - 1) // CHUNK_BYTES


def encrypt_bytes(data: bytes) -> bytes:
    """Заворачивает содержимое в контейнер текущим ключом.

    Без ключа или если данные уже в контейнере — возвращает их как есть: так
    запись работает и до включения шифрования, и при повторной обработке.
    """
    key = at_rest.encryption_key()
    if key is None or is_encrypted_bytes(data):
        return data
    base = os.urandom(at_rest.NONCE_BYTES)
    cipher = AESGCM(key)
    out = bytearray(MAGIC_V2)
    # Номер ключа в заголовке — чтобы при ротации сразу видеть, чей это файл.
    out += at_rest.key_id(key).encode("ascii")
    out += len(data).to_bytes(8, "big")
    out += base
    for index, offset in enumerate(range(0, len(data), CHUNK_BYTES)):
        out += cipher.encrypt(
            _chunk_nonce(base, index), data[offset : offset + CHUNK_BYTES], None
        )
    return bytes(out)


def decrypt_bytes(data: bytes) -> bytes:
    """Возвращает содержимое контейнера. Обычные данные — как есть."""
    if not is_encrypted_bytes(data):
        return data
    header = _parse_header(data)
    plain_size = header.plain_size
    keys = _keys_for(header.key_id)
    out = bytearray()
    for index in range(chunk_count(plain_size)):
        start = header.header_bytes + index * CHUNK_FILE_BYTES
        blob = data[start : start + CHUNK_FILE_BYTES]
        out += _decrypt_chunk(keys, header.base_nonce, index, blob)
    return bytes(out)


def _decrypt_chunk(
    keys: list[bytes], base_nonce: bytes, index: int, blob: bytes
) -> bytes:
    """Расшифровывает один кусок, перебирая известные ключи."""
    last_error: Exception | None = None
    for key in keys:
        try:
            return AESGCM(key).decrypt(_chunk_nonce(base_nonce, index), blob, None)
        except Exception as exc:  # пробуем следующий ключ
            last_error = exc
    raise last_error if last_error is not None else MediaKeyMissing("Нет ключа")


def plaintext_size(path: str | Path) -> int:
    """Размер содержимого файла: из заголовка контейнера или с диска."""
    file_path = Path(path)
    if not is_encrypted_file(file_path):
        return file_path.stat().st_size
    return read_header(file_path).plain_size


def read_file(path: str | Path) -> bytes:
    """Читает файл целиком (расшифровывая, если нужно).

    Для больших файлов лучше ``iter_plaintext``: этот вариант держит содержимое
    в памяти.
    """
    return decrypt_bytes(Path(path).read_bytes())


def iter_plaintext(
    path: str | Path, start: int = 0, end: int | None = None
) -> Iterator[bytes]:
    """Отдаёт содержимое файла от ``start`` до ``end`` (не включая) кусками.

    Расшифровываются только нужные куски: так работает перемотка видео, когда
    браузер просит середину файла.
    """
    file_path = Path(path)
    total = plaintext_size(file_path)
    stop = total if end is None else min(end, total)
    if start >= stop:
        return

    if not is_encrypted_file(file_path):
        with file_path.open("rb") as file:
            file.seek(start)
            remaining = stop - start
            while remaining > 0:
                piece = file.read(min(STREAM_BYTES, remaining))
                if not piece:
                    return
                remaining -= len(piece)
                yield piece
        return

    with file_path.open("rb") as file:
        header = read_header(file_path)
        file.seek(header.header_bytes)
        keys = _keys_for(header.key_id)
        index = start // CHUNK_BYTES
        while start < stop:
            file.seek(header.header_bytes + index * CHUNK_FILE_BYTES)
            plain = _decrypt_chunk(
                keys, header.base_nonce, index, file.read(CHUNK_FILE_BYTES)
            )
            chunk_start = index * CHUNK_BYTES
            taken = min(len(plain), stop - chunk_start)
            yield plain[start - chunk_start : taken]
            start = chunk_start + taken
            index += 1


def write_file(path: str | Path, data: bytes) -> None:
    """Пишет файл (зашифрованным, если включён ключ) — атомарно.

    Атомарность нужна, чтобы клиент никогда не получил наполовину записанный
    файл: подмена происходит одним ``rename``.
    """
    file_path = Path(path)
    payload = encrypt_bytes(data)
    tmp = file_path.with_name(f".{file_path.name}.{os.urandom(6).hex()}.tmp")
    tmp.write_bytes(payload)
    os.replace(tmp, file_path)
