"""Тесты refresh-токенов и их ротации/отзыва.

Чистые проверки формата токена выполняются всегда; ротация/отзыв — только при
заданном ``TEST_DATABASE_URL`` (через conftest).
"""

import uuid

import jwt

from api_v1.auth.refresh_sessions import issue_refresh_token, rotate_refresh_token
from api_v1.auth.utils import (
    REFRESH_TOKEN_AUDIENCE,
    REFRESH_TOKEN_TYPE,
    build_refresh_token,
)
from core.models import User


def _payload(token: str) -> dict:
    return jwt.decode(token, options={"verify_signature": False})


# --- Чистые unit-тесты -------------------------------------------------


def test_refresh_token_has_jti_aud_and_type() -> None:
    token = build_refresh_token(42)
    payload = _payload(token)
    assert payload["sub"] == "42"
    assert payload["type"] == REFRESH_TOKEN_TYPE
    assert payload["aud"] == REFRESH_TOKEN_AUDIENCE
    assert payload.get("jti")


def test_refresh_token_honors_given_jti() -> None:
    token = build_refresh_token(42, jti="abc123")
    assert _payload(token)["jti"] == "abc123"


# --- Интеграционные тесты ротации (нужен PostgreSQL) --------------------


async def _make_user(session, username: str) -> User:
    user = User(
        username=username,
        phone_number=None,
        hashed_password="x",
        is_active=True,
        is_superuser=False,
        is_verified=False,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def test_issue_and_rotate_refresh_token(session) -> None:
    user = await _make_user(session, "refresh_rotate")

    token = await issue_refresh_token(session, user_id=user.id)
    jti = _payload(token)["jti"]

    new_token = await rotate_refresh_token(session, jti=jti, user_id=user.id)
    assert new_token is not None and new_token != token
    new_jti = _payload(new_token)["jti"]

    # Повторное использование «сгоревшего» токена -> None + семейный отзыв.
    assert await rotate_refresh_token(session, jti=jti, user_id=user.id) is None
    # Новый токен тоже отозван семейным отзывом.
    assert await rotate_refresh_token(session, jti=new_jti, user_id=user.id) is None


async def test_rotate_unknown_jti_returns_none(session) -> None:
    user = await _make_user(session, "refresh_ghost")
    ghost = uuid.uuid4().hex
    assert await rotate_refresh_token(session, jti=ghost, user_id=user.id) is None
