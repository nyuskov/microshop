"""Временные учётные данные TURN («TURN REST API»).

Зачем: раньше логин/пароль TURN были статическими и лежали в клиентском бандле —
их можно было вытащить и гонять через наш релей чужой трафик (это трафик и деньги).
Теперь клиент получает пару (username, credential), которая:

* вычисляется по общему секрету HMAC-SHA1 — секрет есть только у сервера и coturn;
* живёт ограниченное время (``TURN_TTL_SECONDS``);
* привязана к конкретному пользователю (в username зашит его id).

Схема — стандартная для coturn: ``--use-auth-secret --static-auth-secret=<секрет>``.
coturn сам проверяет, что ``HMAC-SHA1(secret, username)`` совпадает с паролем и что
срок из username ещё не истёк.
"""

import base64
import hashlib
import hmac
import time

from core.config import settings

__all__ = ["turn_configured", "turn_url_list", "build_credentials", "ice_servers"]

#: Публичный STUN — нужен, чтобы клиент узнал свой внешний адрес даже без TURN.
DEFAULT_STUN_URL = "stun:stun.l.google.com:19302"


def turn_url_list() -> list[str]:
    """Список адресов TURN из конфигурации (пустой, если TURN не настроен)."""
    return [url.strip() for url in settings.turn_urls.split(",") if url.strip()]


def turn_configured() -> bool:
    """Настроен ли TURN: нужны и секрет, и хотя бы один адрес."""
    return bool(settings.turn_secret and turn_url_list())


def build_credentials(user_id: int, *, now: int | None = None) -> dict[str, object]:
    """Считает одноразовую пару (username, credential) для пользователя.

    ``username`` = ``<unix-время истечения>:<id пользователя>`` — так coturn
    понимает срок жизни, а в логах видно, чьи это креды.
    """
    secret = settings.turn_secret or ""
    ttl = max(60, int(settings.turn_ttl_seconds))
    expires_at = (now if now is not None else int(time.time())) + ttl
    username = f"{expires_at}:{user_id}"
    digest = hmac.new(
        secret.encode("utf-8"), username.encode("utf-8"), hashlib.sha1
    ).digest()
    return {
        "username": username,
        "credential": base64.b64encode(digest).decode("ascii"),
        "ttl": ttl,
        "expires_at": expires_at,
    }


def ice_servers(user_id: int) -> list[dict[str, object]]:
    """Список ICE-серверов для ``RTCPeerConnection``.

    STUN отдаём всегда (он не требует учётных данных), TURN — только когда
    настроен: иначе клиент будет ходить в никуда и терять время на сборе
    кандидатов.
    """
    servers: list[dict[str, object]] = [{"urls": DEFAULT_STUN_URL}]
    urls = turn_url_list()
    if urls and settings.turn_secret:
        credentials = build_credentials(user_id)
        servers.append(
            {
                "urls": urls if len(urls) > 1 else urls[0],
                "username": credentials["username"],
                "credential": credentials["credential"],
            }
        )
    return servers
