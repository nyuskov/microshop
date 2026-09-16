"""Тесты шифрования данных «в покое» (core/at_rest.py).

Зачем проверяем: это защита от утечки диска/дампа, и ошибка здесь стоит дорого в
обе стороны. Слишком «умное» шифрование ломает чтение старых данных (чат
превращается в base64), а слишком мягкое — оставляет текст открытым, то есть
защиты нет вовсе. Поэтому проверяем: шифрует, читает, не портит незашифрованное,
переживает отсутствие ключа и мусор вместо шифротекста.

Ключ подставляем через настройки (в бою он приходит из окружения).
"""

import base64

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from core import at_rest
from core.config import settings

KEY = bytes(range(32))
KEY_HEX = KEY.hex()
KEY_B64 = base64.b64encode(KEY).decode()


@pytest.fixture
def with_key(monkeypatch: pytest.MonkeyPatch):
    """Включает шифрование на время теста."""
    monkeypatch.setattr(settings, "at_rest_key", KEY_HEX)


@pytest.fixture
def without_key(monkeypatch: pytest.MonkeyPatch):
    """Шифрование выключено (ключ не задан) — поведение как до фичи."""
    monkeypatch.setattr(settings, "at_rest_key", None)


def test_key_accepts_hex_and_base64(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ключ принимаем и в hex, и в base64 (как удобнее сгенерировать)."""
    monkeypatch.setattr(settings, "at_rest_key", KEY_HEX)
    assert at_rest.encryption_key() == KEY
    monkeypatch.setattr(settings, "at_rest_key", KEY_B64)
    assert at_rest.encryption_key() == KEY


def test_broken_key_disables_encryption(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ключ неверной длины — шифрование выключаем, а не падаем на каждом запросе."""
    monkeypatch.setattr(settings, "at_rest_key", "слишком-короткий-ключ")
    assert at_rest.encryption_key() is None
    assert at_rest.encrypt_text("привет") == "привет"


def test_round_trip(with_key) -> None:  # noqa: ANN001 - фикстура
    """Текст читается обратно, а в «базе» лежит не он."""
    encrypted = at_rest.encrypt_text("секретное сообщение")
    assert encrypted is not None
    assert encrypted.startswith(at_rest.PREFIX)
    assert "секретное сообщение" not in encrypted
    assert at_rest.decrypt_text(encrypted) == "секретное сообщение"


def test_ciphertext_differs_each_time(with_key) -> None:  # noqa: ANN001
    """Одинаковые тексты дают разные шифротексты (свой nonce на значение)."""
    first = at_rest.encrypt_text("привет")
    second = at_rest.encrypt_text("привет")
    assert first != second
    assert at_rest.decrypt_text(first) == at_rest.decrypt_text(second) == "привет"


def test_plain_values_pass_through(with_key) -> None:  # noqa: ANN001
    """Незашифрованное (старые записи) читаем как есть и не шифруем дважды."""
    assert at_rest.decrypt_text("обычный текст") == "обычный текст"
    encrypted = at_rest.encrypt_text("текст")
    assert at_rest.encrypt_text(encrypted) == encrypted


def test_none_is_kept(with_key) -> None:  # noqa: ANN001
    """Пустое значение (сообщение-вложение) остаётся None."""
    assert at_rest.encrypt_text(None) is None
    assert at_rest.decrypt_text(None) is None


def test_disabled_encryption_is_transparent(without_key) -> None:  # noqa: ANN001
    """Без ключа ничего не меняется: пишем и читаем открытый текст."""
    assert at_rest.is_enabled() is False
    assert at_rest.encrypt_text("привет") == "привет"
    assert at_rest.decrypt_text("привет") == "привет"


def test_encrypted_value_without_key_is_returned_as_is(
    with_key,  # noqa: ANN001 - сначала шифруем с ключом
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ключ потеряли: показываем шифротекст, но данные не роняем и не удаляем."""
    encrypted = at_rest.encrypt_text("важное") or ""
    monkeypatch.setattr(settings, "at_rest_key", None)
    assert at_rest.decrypt_text(encrypted) == encrypted


def test_broken_ciphertext_does_not_raise(with_key) -> None:  # noqa: ANN001
    """Испорченное значение (обрезали, подменили) не роняет чтение истории."""
    assert at_rest.decrypt_text(f"{at_rest.PREFIX}не-base64") is not None
    assert at_rest.decrypt_text(f"{at_rest.PREFIX}AAAA") is not None


def test_wrong_key_does_not_crash(with_key) -> None:  # noqa: ANN001
    """Другим ключом расшифровать нельзя — и это не должно падать."""
    encrypted = at_rest.encrypt_text("важное") or ""
    other = AESGCM.generate_key(bit_length=256).hex()
    settings.at_rest_key = other
    try:
        assert at_rest.decrypt_text(encrypted) == encrypted
    finally:
        settings.at_rest_key = KEY_HEX
