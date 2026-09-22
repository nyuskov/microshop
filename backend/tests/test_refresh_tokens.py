"""Тесты refresh-токенов и их ротации/отзыва.

Чистые проверки формата токена выполняются всегда; ротация/отзыв — только при
заданном ``TEST_DATABASE_URL`` (через conftest).
"""

import uuid
from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy import select

from api_v1.auth.refresh_sessions import (
    REUSE_GRACE_SECONDS,
    issue_refresh_token,
    revoke_all_sessions,
    rotate_refresh_token,
)
from api_v1.auth.utils import (
    REFRESH_TOKEN_AUDIENCE,
    REFRESH_TOKEN_TYPE,
    build_refresh_token,
)
from core.models import RefreshSession, User


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


async def _sessions(session, user_id: int) -> list[RefreshSession]:
    """Все сессии пользователя по порядку выдачи."""
    stmt = (
        select(RefreshSession)
        .where(RefreshSession.user_id == user_id)
        .order_by(RefreshSession.id)
    )
    return list((await session.execute(stmt)).scalars().all())


async def _age_first_session(session, user_id: int, seconds: int) -> None:
    """Сдвигает отзыв первой сессии в прошлое (как будто прошло время)."""
    first = (await _sessions(session, user_id))[0]
    first.revoked_at = datetime.now(timezone.utc) - timedelta(seconds=seconds)
    await session.commit()


async def test_issue_and_rotate_refresh_token(session) -> None:
    user = await _make_user(session, "refresh_rotate")

    token = await issue_refresh_token(session, user_id=user.id)
    jti = _payload(token)["jti"]

    new_token = await rotate_refresh_token(session, jti=jti, user_id=user.id)
    assert new_token is not None and new_token != token
    new_jti = _payload(new_token)["jti"]

    # Свежий токен жив и ротируется дальше.
    assert await rotate_refresh_token(session, jti=new_jti, user_id=user.id) is not None


async def test_reuse_within_grace_is_a_race_not_a_theft(session) -> None:
    """Повторное использование старого токена сразу после ротации — гонка.

    Так ведут себя две вкладки одного браузера (или клиент, потерявший ответ и
    повторивший запрос): раньше за это гасилась вся семья сессий и человека
    выбрасывало из приложения во всех окнах (прод 22.09.2026).
    """
    user = await _make_user(session, "refresh_grace")
    token = await issue_refresh_token(session, user_id=user.id)
    jti = _payload(token)["jti"]
    new_token = await rotate_refresh_token(session, jti=jti, user_id=user.id)
    new_jti = _payload(new_token)["jti"]

    # Старый токен пришёл повторно, но потомок жив — выдаём «сестру» и НЕ гасим
    # семью: рабочий токен другой вкладки должен остаться рабочим.
    sibling = await rotate_refresh_token(session, jti=jti, user_id=user.id)
    assert sibling is not None and sibling != new_token
    assert await rotate_refresh_token(session, jti=new_jti, user_id=user.id) is not None


async def test_reuse_after_grace_revokes_the_family(session) -> None:
    """Вне окна прощения повтор токена — по-прежнему кража: гасим все сессии."""
    user = await _make_user(session, "refresh_reuse")
    token = await issue_refresh_token(session, user_id=user.id)
    jti = _payload(token)["jti"]
    new_token = await rotate_refresh_token(session, jti=jti, user_id=user.id)
    new_jti = _payload(new_token)["jti"]

    await _age_first_session(session, user.id, REUSE_GRACE_SECONDS + 5)

    assert await rotate_refresh_token(session, jti=jti, user_id=user.id) is None
    # Новый токен тоже отозван семейным отзывом.
    assert await rotate_refresh_token(session, jti=new_jti, user_id=user.id) is None


async def test_grace_does_not_overrule_a_deliberate_revocation(session) -> None:
    """«Выйти на всех устройствах» окном не обходится.

    После отзыва семьи её потомок тоже погашен — значит повтор старого токена
    опять считается кражей, сколько бы времени ни прошло.
    """
    user = await _make_user(session, "refresh_revoked")
    token = await issue_refresh_token(session, user_id=user.id)
    jti = _payload(token)["jti"]
    assert await rotate_refresh_token(session, jti=jti, user_id=user.id) is not None

    await revoke_all_sessions(session, user_id=user.id)

    assert await rotate_refresh_token(session, jti=jti, user_id=user.id) is None
    assert all(row.revoked_at is not None for row in await _sessions(session, user.id))


async def test_rotate_unknown_jti_returns_none(session) -> None:
    user = await _make_user(session, "refresh_ghost")
    ghost = uuid.uuid4().hex
    assert await rotate_refresh_token(session, jti=ghost, user_id=user.id) is None
