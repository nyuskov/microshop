"""2FA на новом устройстве: подтверждение входа кодом из письма.

Политика (выбор владельца проекта): **вход с нового устройства всегда требует
код**, отключить нельзя. Если подтверждённого e-mail нет или SMTP выключен —
запретить вход нельзя (иначе человек потерял бы доступ к своему аккаунту),
поэтому в этом случае устройство просто запоминается, а владелец получает
письмо-предупреждение (если адрес появится, защита включится сама).

Как это работает:
1. Пользователь входит паролем/кодом (см. ``auth/views.py``).
2. Мы смотрим подпись устройства (sha256 от User-Agent, ``auth/device.py``).
   Она есть в ``login_devices``?
   - да → выдаём токены как обычно;
   - нет → это новый вход: отправляем код на подтверждённый e-mail и
     возвращаем 428 с ``challenge_token`` (никаких токенов).
3. Клиент показывает шаг «код с нового устройства» и зовёт
   ``POST /auth/login/verify-device/`` с этим challenge и кодом: мы проверяем
   подпись challenge (её подделать нельзя — он подписан нашим секретом),
   расходуем код, запоминаем устройство и выдаём токены.

Подпись challenge — обычный JWT с отдельными ``aud``/``type`` (как refresh-токен),
поэтому его нельзя использовать ни как access, ни как refresh; срок жизни —
``auth_device_challenge_expire_seconds``.

Исключение из правила: если текущий вход сам уже подтверждён кодом из письма
(вход по коду на e-mail, сброс пароля), второй код не запрашиваем — владелец
адреса и так только что доказал доступ к ящику.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core import mailer
from core.config import settings
from core.models import LoginDevice, User

from .device import DeviceInfo, device_info

logger = logging.getLogger(__name__)

CHALLENGE_TYPE = "device-verify"
CHALLENGE_AUDIENCE = "pismo:device"


class DeviceChallengeError(Exception):
    """Challenge недействителен (просрочен, подделан или другого типа)."""


def _secret() -> str:
    return settings.auth_jwt.secret_key


def build_challenge(*, user_id: int, device: DeviceInfo) -> str:
    """Собирает короткоживущий JWT «подтвердите вход с этого устройства»."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "dev": device.signature,
        "jti": uuid.uuid4().hex,
        "type": CHALLENGE_TYPE,
        "aud": CHALLENGE_AUDIENCE,
        "iat": now,
        "exp": now + timedelta(seconds=settings.auth_device_challenge_expire_seconds),
    }
    return jwt.encode(payload, _secret(), algorithm=settings.auth_jwt.algorithm)


def decode_challenge(token: str) -> tuple[int, str]:
    """Проверяет challenge и возвращает ``(user_id, подпись устройства)``."""
    try:
        payload = jwt.decode(
            token,
            _secret(),
            algorithms=[settings.auth_jwt.algorithm],
            audience=CHALLENGE_AUDIENCE,
        )
    except jwt.InvalidTokenError as exc:
        raise DeviceChallengeError(str(exc)) from exc

    if payload.get("type") != CHALLENGE_TYPE:
        raise DeviceChallengeError("не тот тип токена")
    sub = str(payload.get("sub", ""))
    if not sub.isdigit():
        raise DeviceChallengeError("нет субъекта")
    return int(sub), str(payload.get("dev", ""))


async def is_known_device(
    session: AsyncSession, *, user_id: int, device: DeviceInfo
) -> bool:
    """Входил ли пользователь раньше с этого устройства."""
    row = await session.scalar(
        select(LoginDevice.id).where(
            LoginDevice.user_id == user_id,
            LoginDevice.signature == device.signature,
        )
    )
    return row is not None


async def has_any_device(session: AsyncSession, *, user_id: int) -> bool:
    """Есть ли у аккаунта хотя бы одно известное устройство (иначе — первый вход)."""
    row = await session.scalar(
        select(LoginDevice.id).where(LoginDevice.user_id == user_id).limit(1)
    )
    return row is not None


def can_verify_by_email(user: User) -> bool:
    """Можем ли мы вообще подтвердить вход кодом (подтверждённый e-mail + SMTP)."""
    return bool(user.email and user.email_verified and mailer.is_configured())


__all__ = [
    "CHALLENGE_AUDIENCE",
    "CHALLENGE_TYPE",
    "DeviceChallengeError",
    "build_challenge",
    "can_verify_by_email",
    "decode_challenge",
    "device_info",
    "has_any_device",
    "is_known_device",
]
