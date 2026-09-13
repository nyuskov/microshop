"""Тесты определения IP клиента для rate-лимитов (``core.rate_limit.client_ip``).

Лимиты «на IP» ломаются ровно в двух случаях, и оба здесь проверяются:
  1) за nginx приложение видит IP прокси — тогда лимит «на IP» превращается в
     лимит на весь сервис;
  2) приложение верит заголовку ``X-Forwarded-For`` от кого угодно — тогда лимит
     обходится подстановкой чужого адреса.
"""

from starlette.datastructures import Headers
from starlette.requests import Request


def _request(peer: str | None, forwarded: str | None = None) -> Request:
    """Собирает минимальный ASGI-scope с нужным адресом соединения и XFF."""
    headers = Headers()
    if forwarded is not None:
        headers = Headers({"x-forwarded-for": forwarded})
    client = (peer, 12345) if peer is not None else None
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/auth/request-otp/",
        "headers": headers.raw,
        "query_string": b"",
        "client": client,
    }
    return Request(  # type: ignore[arg-type]
        scope, receive=lambda: None, send=lambda message: None
    )


def test_uses_forwarded_ip_from_private_peer() -> None:
    """За собственным nginx (приватный peer) берём IP из X-Forwarded-For."""
    from core.rate_limit import client_ip

    request = _request("172.20.0.4", "8.8.8.8")

    assert client_ip(request) == "8.8.8.8"


def test_ignores_forwarded_header_from_public_peer() -> None:
    """Публичный peer — заголовку не верим (иначе лимит легко обойти)."""
    from core.rate_limit import client_ip

    request = _request("8.8.4.4", "10.0.0.1")

    assert client_ip(request) == "8.8.4.4"


def test_takes_first_hop_of_forwarded_chain() -> None:
    """В цепочке берём первый адрес — это исходный клиент (nginx перезаписывает)."""
    from core.rate_limit import client_ip

    request = _request("172.20.0.4", "8.8.8.8, 172.20.0.4")

    assert client_ip(request) == "8.8.8.8"


def test_falls_back_when_forwarded_is_garbage() -> None:
    """Не-IP в заголовке не должен попадать в ключ лимита."""
    from core.rate_limit import client_ip

    request = _request("172.20.0.4", "not-an-ip")

    assert client_ip(request) == "172.20.0.4"


def test_without_client_returns_unknown() -> None:
    """Если адрес соединения неизвестен — не падаем (лимит на общий ключ)."""
    from core.rate_limit import client_ip

    assert client_ip(_request(None)) == "unknown"
