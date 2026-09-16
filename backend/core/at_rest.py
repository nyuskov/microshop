"""Шифрование данных «в покое» (at-rest) ключом сервера.

Зачем: переписка лежит в БД и в файлах открытым текстом. Диск, снапшот, дамп или
случайно скопированный `db_dump/*.sql` — и содержимое чатов читается целиком, без
доступа к серверу и к аккаунтам. Шифрование ключом из окружения закрывает именно
этот сценарий: без ключа (он живёт в `.env`, а не в дампе) данные не прочитать.

Чего это НЕ делает: не защищает от администратора сервера (у него есть и ключ, и
доступ) и не заменяет E2EE — для этого в личных чатах есть сквозное шифрование.
Метаданные (кто, когда, в каком чате, размер файла) остаются видны.

Формат значения: ``enc:v1:<base64(nonce|ciphertext)>`` — AES-256-GCM. Префикс
нужен, чтобы:
* отличить зашифрованное от старого (до включения шифрования) и не портить его
  повторным шифрованием при переносе;
* уметь менять алгоритм: формат версии виден в самой строке.

Если ключ не задан, функции работают «насквозь» (пишем и читаем как есть) — так
существующие базы и тесты живут без обязательной настройки, а шифрование
включается одной переменной окружения.
"""

from __future__ import annotations

import base64
import binascii
import logging
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from core.config import settings

logger = logging.getLogger(__name__)

#: Префикс зашифрованного значения (версия формата).
PREFIX = "enc:v1:"

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
        "AT_REST_KEY задан, но это не 32 байта в hex или base64 — шифрование выключено"
    )
    return None


def encryption_key() -> bytes | None:
    """Ключ шифрования из настроек (None — шифрование выключено)."""
    raw = settings.at_rest_key
    if not raw:
        return None
    return _decode_key(raw)


def is_enabled() -> bool:
    """Включено ли шифрование (задан корректный ключ)."""
    return encryption_key() is not None


def is_encrypted(value: str | None) -> bool:
    """Похоже ли значение на наш шифротекст."""
    if not value:
        return False
    return value.startswith(PREFIX)


def encrypt_text(value: str | None) -> str | None:
    """Шифрует строку. None и уже зашифрованное возвращает как есть."""
    if value is None or is_encrypted(value):
        return value
    key = encryption_key()
    if key is None:
        # Ключа нет — работаем как раньше, данные пишем открыто.
        return value
    nonce = os.urandom(NONCE_BYTES)
    ciphertext = AESGCM(key).encrypt(nonce, value.encode("utf-8"), None)
    blob = base64.b64encode(nonce + ciphertext).decode("ascii")
    return f"{PREFIX}{blob}"


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
    key = encryption_key()
    if key is None:
        logger.warning("Данные зашифрованы, но AT_REST_KEY не задан — читаем как есть")
        return value
    try:
        raw = base64.b64decode(value[len(PREFIX) :], validate=True)
        nonce, ciphertext = raw[:NONCE_BYTES], raw[NONCE_BYTES:]
        return AESGCM(key).decrypt(nonce, ciphertext, None).decode("utf-8")
    except Exception:  # noqa: BLE001 - любая ошибка = отдаём исходное значение
        logger.warning("Не удалось расшифровать значение — отдаём как есть")
        return value
