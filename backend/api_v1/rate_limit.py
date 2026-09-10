"""Простой in-memory rate limiter (скользящее окно) для публичных эндпоинтов.

Подходит для однопроцессного запуска (uvicorn с одним воркером, как в dev).
Для горизонтального масштабирования нужен общий стор (Redis и т.п.).
"""

import asyncio
import ipaddress
import logging
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

logger = logging.getLogger(__name__)


class SlidingWindowLimiter:
    """Ограничивает число вызовов ключа в скользящем окне времени."""

    def __init__(self) -> None:
        self._windows: dict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def allow(self, key: str, *, limit: int, window_seconds: int) -> bool:
        """Регистрирует вызов и возвращает True, если лимит не превышен."""
        now = time.monotonic()
        async with self._lock:
            bucket = self._windows[key]
            # Выкидываем метки, вышедшие за окно.
            while bucket and now - bucket[0] >= window_seconds:
                bucket.popleft()
            if len(bucket) >= limit:
                return False
            bucket.append(now)
            # Редкая чистка, чтобы словарь не рос бесконечно.
            if len(self._windows) > 4096:
                self._prune(now, window_seconds)
            return True

    def reset(self) -> None:
        """Сбрасывает все окна (тесты; после ручной правки лимитов в проде)."""
        self._windows.clear()

    def _prune(self, now: float, window_seconds: int) -> None:
        expired = [
            key
            for key, bucket in self._windows.items()
            if not bucket or now - bucket[-1] >= window_seconds
        ]
        for key in expired:
            del self._windows[key]


rate_limiter = SlidingWindowLimiter()


def rate_limit_key(scope: str, value: str) -> str:
    """Ключ лимита: область применения + значение (например, IP-адрес)."""
    return f"{scope}:{value}"


def client_ip(request: Request) -> str:
    """IP клиента для лимитов — с учётом прокси, но без возможности подмены.

    Приложение стоит за собственным nginx (единственный хоп; он перезаписывает
    ``X-Forwarded-For`` адресом клиента, см. ``frontend/nginx.prod.conf``), поэтому
    при подключении от приватного адреса (docker-сеть) берём первый адрес из
    ``X-Forwarded-For`` — это реальный клиент. Если же запрос пришёл напрямую
    (публичный peer), заголовку не верим: иначе лимиты обходились бы подстановкой
    произвольного адреса.
    """
    peer = request.client.host if request.client is not None else "unknown"
    try:
        from_private_network = ipaddress.ip_address(peer).is_private
    except ValueError:
        from_private_network = False
    if not from_private_network:
        return peer

    forwarded = request.headers.get("x-forwarded-for", "")
    candidate = forwarded.split(",")[0].strip()
    if not candidate:
        return peer
    try:
        ipaddress.ip_address(candidate)
    except ValueError:
        return peer
    return candidate


async def enforce_limit(
    *,
    scope: str,
    value: str,
    limit: int,
    window_seconds: int,
    detail: str,
) -> None:
    """Проверяет скользящий лимит и бросает HTTP 429 при превышении.

    Используется и для публичных (по IP), и для авторизованных (по user.id)
    эндпоинтов — единая точка, чтобы не дублировать логику по вьюхам.
    """
    allowed = await rate_limiter.allow(
        rate_limit_key(scope, value),
        limit=limit,
        window_seconds=window_seconds,
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=detail,
            headers={"Retry-After": str(window_seconds)},
        )
