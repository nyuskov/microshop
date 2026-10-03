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


def test_round_trip(with_key) -> None:  # фикстура
    """Текст читается обратно, а в «базе» лежит не он."""
    encrypted = at_rest.encrypt_text("секретное сообщение")
    assert encrypted is not None
    assert at_rest.is_encrypted(encrypted)
    assert "секретное сообщение" not in encrypted
    assert at_rest.decrypt_text(encrypted) == "секретное сообщение"


def test_ciphertext_differs_each_time(with_key) -> None:
    """Одинаковые тексты дают разные шифротексты (свой nonce на значение)."""
    first = at_rest.encrypt_text("привет")
    second = at_rest.encrypt_text("привет")
    assert first != second
    assert at_rest.decrypt_text(first) == at_rest.decrypt_text(second) == "привет"


def test_plain_values_pass_through(with_key) -> None:
    """Незашифрованное (старые записи) читаем как есть и не шифруем дважды."""
    assert at_rest.decrypt_text("обычный текст") == "обычный текст"
    encrypted = at_rest.encrypt_text("текст")
    assert at_rest.encrypt_text(encrypted) == encrypted


def test_none_is_kept(with_key) -> None:
    """Пустое значение (сообщение-вложение) остаётся None."""
    assert at_rest.encrypt_text(None) is None
    assert at_rest.decrypt_text(None) is None


def test_disabled_encryption_is_transparent(without_key) -> None:
    """Без ключа ничего не меняется: пишем и читаем открытый текст."""
    assert at_rest.is_enabled() is False
    assert at_rest.encrypt_text("привет") == "привет"
    assert at_rest.decrypt_text("привет") == "привет"


def test_encrypted_value_without_key_is_returned_as_is(
    with_key,  # сначала шифруем с ключом
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ключ потеряли: показываем шифротекст, но данные не роняем и не удаляем."""
    encrypted = at_rest.encrypt_text("важное") or ""
    monkeypatch.setattr(settings, "at_rest_key", None)
    assert at_rest.decrypt_text(encrypted) == encrypted


def test_broken_ciphertext_does_not_raise(with_key) -> None:
    """Испорченное значение (обрезали, подменили) не роняет чтение истории."""
    garbage = [
        f"{at_rest.PREFIX_V1}не-base64",
        f"{at_rest.PREFIX_V1}AAAA",
        f"{at_rest.PREFIX_V2}deadbeef:не-base64",
        f"{at_rest.PREFIX_V2}deadbeef:AAAA",
    ]
    for value in garbage:
        assert at_rest.decrypt_text(value) == value


def test_wrong_key_does_not_crash(with_key) -> None:
    """Другим ключом расшифровать нельзя — и это не должно падать."""
    encrypted = at_rest.encrypt_text("важное") or ""
    other = AESGCM.generate_key(bit_length=256).hex()
    settings.at_rest_key = other
    try:
        assert at_rest.decrypt_text(encrypted) == encrypted
    finally:
        settings.at_rest_key = KEY_HEX


# --- Ротация ключа (docs/at-rest-rotation.md) ---------------------------


def _encrypt_with(key_hex: str, value: str, monkeypatch: pytest.MonkeyPatch) -> str:
    """Значение, каким его записала бы версия с таким ключом."""
    monkeypatch.setattr(settings, "at_rest_key", key_hex)
    return at_rest.encrypt_text(value) or ""


def test_new_values_carry_key_id(with_key) -> None:
    """В новом формате есть номер ключа — по нему выбираем ключ при чтении."""
    value = at_rest.encrypt_text("привет") or ""

    assert value.startswith(f"{at_rest.PREFIX_V2}{at_rest.key_id(KEY)}:")
    assert at_rest.encrypted_with_current_key(value) is True
    assert at_rest.encrypted_with_current_key(f"{at_rest.PREFIX_V1}AAAA") is False


def test_old_key_values_readable_after_rotation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """После смены ключа история читается: старый ключ в AT_REST_KEY_PREVIOUS."""
    old = _encrypt_with(KEY_HEX, "старое значение", monkeypatch)
    new_key_hex = bytes(range(32, 64)).hex()
    monkeypatch.setattr(settings, "at_rest_key", new_key_hex)
    monkeypatch.setattr(settings, "at_rest_key_previous", KEY_HEX)

    assert at_rest.decrypt_text(old) == "старое значение"
    # Новое значение пишем уже новым ключом, и оно помечено его номером.
    fresh = at_rest.encrypt_text("новое значение") or ""
    assert at_rest.encrypted_with_current_key(fresh) is True
    assert at_rest.decrypt_text(fresh) == "новое значение"
    # Старое значение ротации ещё не прошло — его нужно перешифровать.
    assert at_rest.encrypted_with_current_key(old) is False


def test_several_previous_keys_are_supported(monkeypatch: pytest.MonkeyPatch) -> None:
    """Переживаем несколько ротаций: прошлые ключи — списком через запятую."""
    first = _encrypt_with(bytes(range(32)).hex(), "первое", monkeypatch)
    second = _encrypt_with(bytes(range(32, 64)).hex(), "второе", monkeypatch)
    third_hex = bytes(range(64, 96)).hex()
    monkeypatch.setattr(settings, "at_rest_key", third_hex)
    monkeypatch.setattr(
        settings,
        "at_rest_key_previous",
        f"{bytes(range(32)).hex()}, {bytes(range(32, 64)).hex()}",
    )

    assert at_rest.decrypt_text(first) == "первое"
    assert at_rest.decrypt_text(second) == "второе"
    assert len(at_rest.previous_keys()) == 2


def test_previous_entry_that_never_was_a_key_is_skipped(
    with_key, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Мусор в списке прошлых ключей не ломает чтение (и текущий не дублируем)."""
    monkeypatch.setattr(settings, "at_rest_key_previous", f"не-ключ, {KEY_HEX}, ")
    assert at_rest.previous_keys() == []
    assert at_rest.decryption_keys() == [(at_rest.key_id(KEY), KEY)]


def test_v1_values_readable_without_key_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """Старый формат (enc:v1) читается перебором известных ключей."""
    key = KEY
    nonce = bytes(12)
    blob = base64.b64encode(
        nonce + AESGCM(key).encrypt(nonce, "старое".encode(), None)
    ).decode()
    value = f"{at_rest.PREFIX_V1}{blob}"
    monkeypatch.setattr(settings, "at_rest_key", bytes(range(32, 64)).hex())
    monkeypatch.setattr(settings, "at_rest_key_previous", KEY_HEX)

    assert at_rest.encrypted_with_current_key(value) is False
    assert at_rest.decrypt_text(value) == "старое"


def test_value_with_unknown_key_id_is_not_readable(
    with_key, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Чужой номер ключа: пробуем остальные ключи, но не выдумываем данные."""
    stranger = at_rest.PREFIX_V2 + "ffffffff:" + base64.b64encode(bytes(40)).decode()
    assert at_rest.decrypt_text(stranger) == stranger
