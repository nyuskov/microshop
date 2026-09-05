import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict

logger = logging.getLogger(__name__)

# Временное хранилище OTP в памяти. НЕ ПОДХОДИТ для продакшена!
_OTP_STORAGE: Dict[str, tuple[str, datetime]] = {}
_LOCK = asyncio.Lock()


async def store_otp(phone_number: str, otp_code: str, ttl_seconds: int = 300) -> None:
    """Сохраняет OTP-код с заданным временем жизни (TTL) в секундах."""
    expiry_time = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
    async with _LOCK:
        _OTP_STORAGE[phone_number] = (otp_code, expiry_time)
    logger.info("Stored OTP for %s, expires at %s", phone_number, expiry_time)


async def verify_otp(phone_number: str, otp_code: str) -> bool:
    """Проверяет OTP-код и его срок действия."""
    async with _LOCK:
        stored_data = _OTP_STORAGE.get(phone_number)
        if not stored_data:
            logger.warning("No OTP found for %s", phone_number)
            return False

        stored_otp, expiry_time = stored_data
        if datetime.now(timezone.utc) > expiry_time:
            del _OTP_STORAGE[phone_number]
            logger.info("OTP for %s has expired and was removed.", phone_number)
            return False

        if stored_otp == otp_code:
            del _OTP_STORAGE[phone_number]
            logger.info("OTP for %s verified successfully.", phone_number)
            return True

        logger.warning(
            "Invalid OTP for %s. Expected: %s, Got: %s",
            phone_number,
            stored_otp,
            otp_code,
        )
        return False
