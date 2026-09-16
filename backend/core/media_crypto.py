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

Формат файла (``encf:v1``)::

    0   8   magic «encf:v1:»
    8   8   размер содержимого (uint64, big-endian)
    16  12  базовый nonce
    28  ... куски: для каждого — AES-256-GCM(ciphertext||tag)

Кусок i шифруется nonce'ом «базовый nonce без последних 4 байт + номер куска».
Кусок занимает ``len(открытых данных) + 16`` байт, открытых данных — не больше
``CHUNK_BYTES``, поэтому позиция любого байта в файле считается арифметикой:
``offset = HEADER_BYTES + (позиция // CHUNK_BYTES) * (CHUNK_BYTES + 16)``.

Ключа нет — функции работают «насквозь» (пишем и читаем как раньше), поэтому
включать шифрование можно в любой момент и на живой базе: старые файлы читаются
как есть, новые пишутся зашифрованными, а перешифровать историю — скриптом
``scripts/encrypt_media.py``.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Iterator
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from core import at_rest

logger = logging.getLogger(__name__)

#: Признак нашего контейнера в начале файла (он же — версия формата).
MAGIC = b"encf:v1:"

#: magic (8) + размер содержимого (8) + базовый nonce (12).
HEADER_BYTES = 28

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
    """Начинается ли содержимое с нашего заголовка."""
    return data.startswith(MAGIC)


def is_encrypted_file(path: str | Path) -> bool:
    """Зашифрован ли файл на диске (нет файла — считаем, что нет)."""
    try:
        with Path(path).open("rb") as file:
            return file.read(len(MAGIC)) == MAGIC
    except OSError:
        return False


def _chunk_nonce(base: bytes, index: int) -> bytes:
    """Nonce куска: базовый без последних 4 байт плюс номер куска."""
    return base[: at_rest.NONCE_BYTES - 4] + index.to_bytes(4, "big")


def chunk_count(plain_size: int) -> int:
    """Сколько кусков занимает содержимое такого размера."""
    if plain_size <= 0:
        return 0
    return (plain_size + CHUNK_BYTES - 1) // CHUNK_BYTES


def encrypt_bytes(data: bytes) -> bytes:
    """Заворачивает содержимое в контейнер.

    Без ключа или если данные уже в контейнере — возвращает их как есть: так
    запись работает и до включения шифрования, и при повторной обработке.
    """
    key = at_rest.encryption_key()
    if key is None or is_encrypted_bytes(data):
        return data
    base = os.urandom(at_rest.NONCE_BYTES)
    cipher = AESGCM(key)
    out = bytearray(MAGIC)
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
    if len(data) < HEADER_BYTES:
        raise ValueError("Повреждённый контейнер media")
    plain_size = int.from_bytes(data[8:16], "big")
    base = data[16:HEADER_BYTES]
    cipher = AESGCM(_require_key())
    out = bytearray()
    for index in range(chunk_count(plain_size)):
        start = HEADER_BYTES + index * CHUNK_FILE_BYTES
        out += cipher.decrypt(
            _chunk_nonce(base, index), data[start : start + CHUNK_FILE_BYTES], None
        )
    return bytes(out)


def _require_key() -> bytes:
    """Ключ шифрования; без него читать зашифрованное нечем."""
    key = at_rest.encryption_key()
    if key is None:
        raise MediaKeyMissing("AT_REST_KEY не задан — зашифрованный файл не прочитать")
    return key


def plaintext_size(path: str | Path) -> int:
    """Размер содержимого файла: из заголовка контейнера или с диска."""
    file_path = Path(path)
    if not is_encrypted_file(file_path):
        return file_path.stat().st_size
    with file_path.open("rb") as file:
        header = file.read(HEADER_BYTES)
    if len(header) < HEADER_BYTES:
        raise ValueError("Повреждённый контейнер media")
    return int.from_bytes(header[8:16], "big")


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
        base = file.read(HEADER_BYTES)[16:HEADER_BYTES]
        cipher = AESGCM(_require_key())
        index = start // CHUNK_BYTES
        while start < stop:
            file.seek(HEADER_BYTES + index * CHUNK_FILE_BYTES)
            plain = cipher.decrypt(
                _chunk_nonce(base, index), file.read(CHUNK_FILE_BYTES), None
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
