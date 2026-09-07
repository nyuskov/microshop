"""Юнит-тесты rate limiter (без БД)."""

import asyncio

from api_v1.rate_limit import SlidingWindowLimiter


async def test_limiter_allows_up_to_limit_then_blocks() -> None:
    limiter = SlidingWindowLimiter()
    for _ in range(5):
        assert await limiter.allow("key", limit=5, window_seconds=60)
    assert not await limiter.allow("key", limit=5, window_seconds=60)


async def test_limiter_window_expiry() -> None:
    limiter = SlidingWindowLimiter()
    for _ in range(3):
        assert await limiter.allow("key", limit=3, window_seconds=1)
    # Лимит исчерпан...
    assert not await limiter.allow("key", limit=3, window_seconds=1)
    # ...но после окончания окна запись проходит снова.
    await asyncio.sleep(1.05)
    assert await limiter.allow("key", limit=3, window_seconds=1)


async def test_limiter_keys_are_independent() -> None:
    limiter = SlidingWindowLimiter()
    assert await limiter.allow("a", limit=1, window_seconds=60)
    assert not await limiter.allow("a", limit=1, window_seconds=60)
    assert await limiter.allow("b", limit=1, window_seconds=60)
