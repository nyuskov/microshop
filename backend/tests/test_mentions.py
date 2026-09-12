"""Упоминания `@логин` в тексте сообщения (unit-тесты, без БД).

Правило должно совпадать с подсветкой на клиенте
(`frontend/src/utils/mentions.ts`, `MENTION_RE`).
"""

from core.mentions import mentioned_logins, mentions_login


def test_finds_logins() -> None:
    assert mentioned_logins("привет @ivan, глянь @Anna.P_2") == {"ivan", "anna.p_2"}


def test_lowercases_logins() -> None:
    assert mentioned_logins("@IVAN") == {"ivan"}


def test_skips_email_like_text() -> None:
    """`почта@пример.ру` — не упоминание: адрес почты не должен «звать» человека."""
    assert mentioned_logins("пиши на почта@пример.ру") == set()


def test_skips_too_short_login() -> None:
    assert mentioned_logins("@a") == set()


def test_empty_text() -> None:
    assert mentioned_logins(None) == set()
    assert mentioned_logins("") == set()
    assert mentioned_logins("без упоминаний") == set()


def test_mentions_login_checks_specific_person() -> None:
    assert mentions_login("привет @ivan!", "IVAN") is True
    assert mentions_login("привет @ivan!", "petr") is False
    assert mentions_login("привет", "ivan") is False
    assert mentions_login("@ivan", None) is False
