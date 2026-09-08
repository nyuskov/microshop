"""Тесты хранилища OTP.

Чистые юнит-тесты хеширования выполняются всегда. Интеграционные тесты
(БД) — только если задан ``TEST_DATABASE_URL`` (PostgreSQL), иначе пропускаются.
"""

import os

import pytest
import pytest_asyncio

from api_v1.auth.otp_storage import (
    OtpVerifyResult,
    _hash_code,
    can_request_new_code,
    store_otp,
    verify_otp,
)

PHONE = "+79990001122"

DB_TEST = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для БД-тестов OTP)",
)


# --- Чистые unit-тесты -------------------------------------------------


def test_hash_code_deterministic() -> None:
    assert _hash_code(PHONE, "123456") == _hash_code(PHONE, "123456")


def test_hash_code_differs_for_code_and_phone() -> None:
    assert _hash_code(PHONE, "123456") != _hash_code(PHONE, "654321")
    assert _hash_code(PHONE, "123456") != _hash_code("+79991112233", "123456")


def test_hash_is_sha256_hex() -> None:
    code_hash = _hash_code(PHONE, "123456")
    assert len(code_hash) == 64
    int(code_hash, 16)  # валидный hex


# --- In-memory блокировка номера после перебора ------------------------


def test_verify_lockout_blocks_and_expires() -> None:
    from datetime import timedelta

    from api_v1.auth import otp_storage
    from api_v1.auth.otp_storage import (
        mark_phone_verify_lockout,
        phone_verify_locked_out,
    )

    try:
        # Сразу после пометки номер заблокирован.
        mark_phone_verify_lockout(PHONE, duration_seconds=60)
        assert phone_verify_locked_out(PHONE)

        # Искусственно «прокручиваем» время — блокировка снимается и чистится.
        otp_storage._verify_lockouts[PHONE] = otp_storage._now() - timedelta(seconds=1)
        assert not phone_verify_locked_out(PHONE)
        assert PHONE not in otp_storage._verify_lockouts
    finally:
        otp_storage._verify_lockouts.pop(PHONE, None)


def test_verify_lockout_unset_phone_is_free() -> None:
    from api_v1.auth.otp_storage import phone_verify_locked_out

    assert not phone_verify_locked_out("+79991112233")


# --- Интеграционные тесты (нужен PostgreSQL) ---------------------------


@pytest_asyncio.fixture
async def otp_engine():
    """Создаёт engine на TEST_DATABASE_URL и таблицу otp_codes (только её)."""
    from sqlalchemy.ext.asyncio import create_async_engine

    from core.models import Base

    url = os.environ["TEST_DATABASE_URL"]
    engine = create_async_engine(url)
    table = Base.metadata.tables["otp_codes"]
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: table.create(sync_conn, checkfirst=True))
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: table.drop(sync_conn, checkfirst=True))
    await engine.dispose()


@pytest_asyncio.fixture
async def session(otp_engine):
    from sqlalchemy.ext.asyncio import async_sessionmaker

    factory = async_sessionmaker(otp_engine, expire_on_commit=False)
    async with factory() as session:
        yield session


@DB_TEST
async def test_cooldown_blocks_resend(session) -> None:
    await store_otp(session, phone_number=PHONE, code="111111", ttl_seconds=300)
    # Сразу после отправки повторный запрос запрещён (кулдаун большой).
    assert not await can_request_new_code(
        session, phone_number=PHONE, cooldown_seconds=60
    )
    # Нулевой кулдаун разрешает.
    assert await can_request_new_code(session, phone_number=PHONE, cooldown_seconds=0)


@DB_TEST
async def test_wrong_code_counts_attempts_then_burns(session) -> None:
    await store_otp(session, phone_number=PHONE, code="111111", ttl_seconds=300)
    for _ in range(3):
        result = await verify_otp(
            session, phone_number=PHONE, code="000000", max_attempts=3
        )
        assert result is OtpVerifyResult.INVALID
    # Превышен лимит попыток — код «сгорел».
    result = await verify_otp(
        session, phone_number=PHONE, code="000000", max_attempts=3
    )
    assert result is OtpVerifyResult.TOO_MANY
    # Верный код больше не подойдёт (запись удалена).
    result = await verify_otp(
        session, phone_number=PHONE, code="111111", max_attempts=3
    )
    assert result is OtpVerifyResult.NOT_FOUND


@DB_TEST
async def test_correct_code_succeeds(session) -> None:
    await store_otp(session, phone_number=PHONE, code="123456", ttl_seconds=300)
    result = await verify_otp(
        session, phone_number=PHONE, code="123456", max_attempts=3
    )
    assert result is OtpVerifyResult.OK
    # После успеха код удалён.
    result = await verify_otp(
        session, phone_number=PHONE, code="123456", max_attempts=3
    )
    assert result is OtpVerifyResult.NOT_FOUND
