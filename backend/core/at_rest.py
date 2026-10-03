"""Шифрование данных «в покое» (at-rest) ключом сервера.

Зачем: переписка лежит в БД и в файлах открытым текстом. Диск, снапшот, дамп или
случайно скопированный `db_dump/*.sql` — и содержимое чатов читается целиком, без
доступа к серверу и к аккаунтам. Шифрование ключом из окружения закрывает именно
этот сценарий: без ключа (он живёт в `.env`, а не в дампе) данные не прочитать.

Чего это НЕ делает: не защищает от администратора сервера (у него есть и ключ, и
доступ) и не заменяет E2EE — для этого в личных чатах есть сквозное шифрование.
Метаданные (кто, когда, в каком чате, размер файла) остаются видны.

Формат значения — AES-256-GCM:

* ``enc:v1:<base64(nonce|ciphertext)>`` — старый формат, в нём нет номера ключа;
* ``enc:v2:<id ключа>:<base64(nonce|ciphertext)>`` — текущий формат: ``id`` — это
  первые 8 hex-символов SHA-256 ключа. Так при ротации видно, каким ключом
  записано значение, и не приходится перебирать все ключи на каждом чтении.

Ротация (``docs/at-rest-rotation.md``): пишем всегда текущим ``AT_REST_KEY``, а
читаем текущим и теми, что перечислены в ``AT_REST_KEY_PREVIOUS`` (можно
несколько через запятую — при нескольких прошлых ротациях). Старые значения в
формате ``v1`` читаются перебором известных ключей; чтобы перевести историю на
новый ключ, скрипты запускают с ``--rotate``, после чего предыдущий ключ убирают.

Если ключ не задан, функции работают «насквозь» (пишем и читаем как есть) — так
существующие базы и тесты живут без обязательной настройки, а шифрование
включается одной переменной окружения.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import logging
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from core.config import settings

logger = logging.getLogger(__name__)

#: Версии формата: старая (без номера ключа) и текущая.
PREFIX_V1 = "enc:v1:"
PREFIX_V2 = "enc:v2:"

#: Общий признак «похоже на шифротекст» — для SQL-фильтров (``LIKE 'enc:%'``).
MARKER = "enc:"

#: Сколько символов SHA-256 ключа используем как его номер.
KEY_ID_CHARS = 8

#: Длина ключа AES-256 и размер nonce для GCM.
KEY_BYTES = 32
NONCE_BYTES = 12


def _decode_key(raw: str) -> bytes | None:
    """Ключ из настройки: base64 или hex, длиной ровно 32 байта."""
    value = raw.strip()
    if not value:
        return None
    candidates: list[bytes] = []
    # hex (64 символа) — удобно генерировать: `openssl rand -hex 32`
    try:
        candidates.append(binascii.unhexlify(value))
    except (binascii.Error, ValueError):
        pass
    # base64 — `openssl rand -base64 32`
    try:
        candidates.append(base64.b64decode(value, validate=True))
    except (binascii.Error, ValueError):
        pass
    for candidate in candidates:
        if len(candidate) == KEY_BYTES:
            return candidate
    logger.warning(
        "Ключ at-rest задан, но это не 32 байта в hex или base64 — пропускаем его"
    )
    return None


def key_id(key: bytes) -> str:
    """Номер ключа: короткий отпечаток, по нему выбираем ключ при чтении.

    Полный хеш ключа публиковать не нужно, а 4 байта достаточно, чтобы отличить
    свои ключи друг от друга (и ничего не говорят о самом ключе).
    """
    return hashlib.sha256(key).hexdigest()[:KEY_ID_CHARS]


def encryption_key() -> bytes | None:
    """Текущий ключ шифрования из настроек (None — шифрование выключено)."""
    raw = settings.at_rest_key
    if not raw:
        return None
    return _decode_key(raw)


def previous_keys() -> list[bytes]:
    """Ключи, которыми только ЧИТАЕМ (для значений, ещё не перешифрованных)."""
    raw = settings.at_rest_key_previous or ""
    keys: list[bytes] = []
    current = encryption_key()
    for chunk in raw.split(","):
        key = _decode_key(chunk)
        if key is None or key == current or key in keys:
            continue
        keys.append(key)
    return keys


def decryption_keys() -> list[tuple[str, bytes]]:
    """Пары «номер ключа → ключ» в порядке проверки: текущий, затем прошлые."""
    keys: list[tuple[str, bytes]] = []
    current = encryption_key()
    if current is not None:
        keys.append((key_id(current), current))
    for key in previous_keys():
        keys.append((key_id(key), key))
    return keys


def is_enabled() -> bool:
    """Включено ли шифрование (задан корректный ключ)."""
    return encryption_key() is not None


def is_encrypted(value: str | None) -> bool:
    """Похоже ли значение на наш шифротекст (любой версии формата)."""
    if not value:
        return False
    return value.startswith(PREFIX_V1) or value.startswith(PREFIX_V2)


def encrypted_with_current_key(value: str | None) -> bool:
    """Записано ли значение ТЕКУЩИМ ключом.

    Для формата ``v1`` ответ всегда «нет»: номера ключа в нём нет, поэтому при
    ротации такие значения нужно перешифровать (иначе непонятно, чей это ключ).
    """
    if not value or not value.startswith(PREFIX_V2):
        return False
    current = encryption_key()
    if current is None:
        return False
    return value.startswith(f"{PREFIX_V2}{key_id(current)}:")


def _split(value: str) -> tuple[str | None, str]:
    """Разбирает значение: ``(номер ключа или None, base64)``."""
    if value.startswith(PREFIX_V2):
        rest = value[len(PREFIX_V2) :]
        identifier, _, blob = rest.partition(":")
        return identifier, blob
    return None, value[len(PREFIX_V1) :]


def encrypt_text(value: str | None) -> str | None:
    """Шифрует строку текущим ключом. None и уже зашифрованное — как есть."""
    if value is None or is_encrypted(value):
        return value
    key = encryption_key()
    if key is None:
        # Ключа нет — работаем как раньше, данные пишем открыто.
        return value
    nonce = os.urandom(NONCE_BYTES)
    ciphertext = AESGCM(key).encrypt(nonce, value.encode("utf-8"), None)
    blob = base64.b64encode(nonce + ciphertext).decode("ascii")
    return f"{PREFIX_V2}{key_id(key)}:{blob}"


def decrypt_text(value: str | None) -> str | None:
    """Расшифровывает строку.

    Незашифрованное значение (старые данные или выключенный ключ) возвращаем как
    есть: читать нужно и то, что было записано до включения шифрования. Если
    строка помечена как зашифрованная, но ключа нет или данные испорчены —
    возвращаем исходное значение и пишем предупреждение: терять данные хуже, чем
    показать шифротекст.
    """
    if value is None or not is_encrypted(value):
        return value

    identifier, blob = _split(value)
    candidates = decryption_keys()
    if not candidates:
        logger.warning("Данные зашифрованы, но ключа at-rest нет — читаем как есть")
        return value
    # Сначала ключ с тем же номером (обычный случай), потом остальные — так
    # значение, записанное прошлым ключом, читается и без ротации.
    ordered = [key for known, key in candidates if known == identifier]
    ordered += [key for known, key in candidates if known != identifier]

    try:
        raw = base64.b64decode(blob, validate=True)
    except (binascii.Error, ValueError):
        logger.warning("Значение помечено зашифрованным, но это не base64")
        return value
    nonce, ciphertext = raw[:NONCE_BYTES], raw[NONCE_BYTES:]
    for key in ordered:
        try:
            return AESGCM(key).decrypt(nonce, ciphertext, None).decode("utf-8")
        except Exception:  # пробуем следующий ключ
            continue
    logger.warning("Не удалось расшифровать значение — отдаём как есть")
    return value
