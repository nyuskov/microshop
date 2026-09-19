"""Тесты выдачи временных TURN-кредов (TURN REST API).

Проверяем главное свойство: пароль считается из общего секрета по HMAC-SHA1,
зависит от пользователя и от срока — то есть статического пароля в клиенте нет,
а украденная пара перестаёт работать после истечения срока.
"""

import base64
import hashlib
import hmac

import pytest

from api_v1.calls import turn
from core.config import settings

SECRET = "test-turn-secret"


@pytest.fixture(autouse=True)
def turn_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Включает TURN на время теста (в CI переменных окружения нет)."""
    monkeypatch.setattr(settings, "turn_secret", SECRET)
    monkeypatch.setattr(settings, "turn_urls", "turn:turn.example:3478?transport=udp")
    monkeypatch.setattr(settings, "turn_ttl_seconds", 600)


def expected_credential(username: str) -> str:
    digest = hmac.new(SECRET.encode(), username.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


def test_credentials_match_coturn_algorithm() -> None:
    """Пароль — base64(HMAC-SHA1(secret, "<expiry>:<user_id>"))."""
    result = turn.build_credentials(42, now=1_000_000)
    username = "1000600:42"
    assert result["username"] == username
    assert result["credential"] == expected_credential(username)
    assert result["ttl"] == 600
    assert result["expires_at"] == 1_000_600


def test_credentials_differ_per_user() -> None:
    """Разным пользователям — разные пары (по логам видно, кто релеил трафик)."""
    first = turn.build_credentials(1, now=1_000_000)
    second = turn.build_credentials(2, now=1_000_000)
    assert first["username"] != second["username"]
    assert first["credential"] != second["credential"]


def test_credentials_are_time_limited() -> None:
    """Через TTL секунд пара меняется — украденная не работает вечно."""
    now = turn.build_credentials(7, now=1_000_000)
    later = turn.build_credentials(7, now=1_000_600)
    assert now["credential"] != later["credential"]
    assert later["username"] != now["username"]


def test_ttl_is_never_shorter_than_a_minute() -> None:
    """Слишком маленький TTL в env не должен ломать звонок."""
    settings.turn_ttl_seconds = 1
    result = turn.build_credentials(3, now=1_000_000)
    assert result["ttl"] == 60


def test_ice_servers_include_stun_and_turn() -> None:
    """В списке есть публичный STUN и TURN с кредами — UDP и запасной TCP."""
    servers = turn.ice_servers(5)
    assert servers[0]["urls"] == turn.DEFAULT_STUN_URL
    turn_entry = servers[1]
    assert turn_entry["urls"] == [
        "turn:turn.example:3478?transport=udp",
        "turn:turn.example:3478?transport=tcp",
    ]
    assert turn_entry["username"] and turn_entry["credential"]


def test_turn_urls_get_tcp_fallback() -> None:
    """К адресу без параметров добавляется TCP-вариант (UDP бывает закрыт).

    В корпоративных сетях и у части операторов UDP закрыт — без запасного TCP
    звонок не собирается вовсе. Адрес TLS (`turns:`) второй раз не дублируем.
    """
    settings.turn_urls = "turn:turn.example:3478, turns:turn.example:5349"

    assert turn.relay_url_list() == [
        "turn:turn.example:3478",
        "turn:turn.example:3478?transport=tcp",
        "turns:turn.example:5349",
    ]


def test_turn_urls_do_not_duplicate_tcp() -> None:
    """Если TCP уже задан явно, второй такой же строки не появляется."""
    settings.turn_urls = "turn:turn.example:3478?transport=tcp"

    assert turn.relay_url_list() == ["turn:turn.example:3478?transport=tcp"]


def test_turn_urls_support_several_addresses() -> None:
    """Несколько адресов (udp/tcp/tls) отдаются одним списком."""
    settings.turn_urls = (
        "turn:turn.example:3478?transport=udp, turns:turn.example:5349?transport=tcp"
    )
    assert turn.turn_url_list() == [
        "turn:turn.example:3478?transport=udp",
        "turns:turn.example:5349?transport=tcp",
    ]
    servers = turn.ice_servers(1)
    assert servers[1]["urls"] == [
        "turn:turn.example:3478?transport=udp",
        "turn:turn.example:3478?transport=tcp",
        "turns:turn.example:5349?transport=tcp",
    ]


def test_without_secret_turn_is_skipped() -> None:
    """Без секрета TURN не отдаём: иначе клиент будет ходить в никуда."""
    settings.turn_secret = None
    assert turn.turn_configured() is False
    servers = turn.ice_servers(1)
    assert [item["urls"] for item in servers] == [turn.DEFAULT_STUN_URL]


def test_turn_configured_requires_addresses_too() -> None:
    """Секрет без адресов — тоже не настроенный TURN."""
    settings.turn_urls = ""
    assert turn.turn_configured() is False
