"""Тесты хранилища OTP.

Чистые юнит-тесты хеширования/блокировки выполняются всегда. Интеграционные
(БД) используют общую фикстуру ``session`` из conftest: схема накатана alembic
(в CI — отдельным шагом), таблицы между тестами очищаются TRUNCATE, а без
``TEST_DATABASE_URL`` фикстура сама пропускает тесты.
"""

from api_v1.auth.otp_storage import (
    OtpVerifyResult,
    _hash_code,
    can_request_new_code,
    store_otp,
    verify_otp,
)

PHONE = "+79990001122"


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


# --- Интеграционные тесты (нужен PostgreSQL, фикстура session из conftest) -


async def test_cooldown_blocks_resend(session) -> None:
    await store_otp(session, phone_number=PHONE, code="111111", ttl_seconds=300)
    # Сразу после отправки повторный запрос запрещён (кулдаун большой).
    assert not await can_request_new_code(
        session, phone_number=PHONE, cooldown_seconds=60
    )
    # Нулевой кулдаун разрешает.
    assert await can_request_new_code(session, phone_number=PHONE, cooldown_seconds=0)


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
