"""Настройки паков эмодзи: чистка списков перед сохранением.

Сервер принимает список целиком (``PUT``), поэтому вся защита от мусора — в
этих двух функциях. Проверяем то, что реально прилетит от клиента: дубли
(человек нажал «добавить» дважды), пустые строки, слишком длинные ключи,
гигантские списки и «эмодзи» из посторонних символов.
"""

from __future__ import annotations

from api_v1.users.emoji import (
    MAX_EMOJI_LEN,
    MAX_FAVORITES,
    MAX_PACK_CHOICES,
    MAX_PACK_KEY,
    clean_favorites,
    clean_pack_keys,
)


def test_pack_keys_keep_order_and_drop_duplicates() -> None:
    """Порядок паков — это порядок вкладок, его нельзя «пересортировать»."""
    keys = ["smileys", "animals", "smileys", "  ", "gestures"]

    assert clean_pack_keys(keys) == ["smileys", "animals", "gestures"]


def test_pack_keys_have_limits() -> None:
    """Слишком длинные ключи и перебор по количеству отсекаем."""
    assert clean_pack_keys(["x" * (MAX_PACK_KEY + 1), "ok"]) == ["ok"]
    assert len(clean_pack_keys([f"pack{index}" for index in range(100)])) == (
        MAX_PACK_CHOICES
    )


def test_favorites_keep_emoji_as_is() -> None:
    """Флаг и семья — один элемент списка, внутренние пробелы не трогаем."""
    items = ["🇷🇺", "👨‍👩‍👧", "🙂 🙂", "🇷🇺"]

    assert clean_favorites(items) == ["🇷🇺", "👨‍👩‍👧", "🙂 🙂"]


def test_favorites_have_limits() -> None:
    """Мусор, длинные строки и перебор — отсекаем."""
    assert clean_favorites(["", "   ", "x" * (MAX_EMOJI_LEN + 1), "🙂"]) == ["🙂"]
    assert len(clean_favorites([f"🙂{index}" for index in range(500)])) == MAX_FAVORITES
