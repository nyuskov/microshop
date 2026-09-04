import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# Временное хранилище OTP в памяти. НЕ ПОДХОДИТ для продакшена!
# Для продакшена используйте Redis или другое решение.
_OTP_STORAGE: Dict[str, tuple[str, datetime]] = {}
_LOCK = asyncio.Lock()


async def store_otp(phone_number: str, otp_code: str, ttl_seconds: int = 300) -> None:
    """
    Сохраняет OTP-код для номера телефона с заданным временем жизни (TTL) в секундах.
    По умолчанию TTL = 300 секунд (5 минут).
    """
    expiry_time = datetime.utcnow() + timedelta(seconds=ttl_seconds)
    async with _LOCK:
        _OTP_STORAGE[phone_number] = (otp_code, expiry_time)
    logger.info(f"Stored OTP for {phone_number}, expires at {expiry_time}")


async def verify_otp(phone_number: str, otp_code: str) -> bool:
    """
    Проверяет, соответствует ли предоставленный OTP-код сохраненному для номера телефона
    и не истекло ли его время.
    """
    async with _LOCK:
        stored_data = _OTP_STORAGE.get(phone_number)
        if not stored_data:
            logger.warning(f"No OTP found for {phone_number}")
            return False

        stored_otp, expiry_time = stored_data
        if datetime.utcnow() > expiry_time:
            # Удаляем просроченный OTP
            del _OTP_STORAGE[phone_number]
            logger.info(f"OTP for {phone_number} has expired and was removed.")
            return False

        if stored_otp == otp_code:
            # Удаляем OTP после успешной проверки
            del _OTP_STORAGE[phone_number]
            logger.info(f"OTP for {phone_number} verified successfully.")
            return True
        else:
            logger.warning(
                f"Invalid OTP for {phone_number}. Expected: {stored_otp}, Got: {otp_code}"
            )
            return False
