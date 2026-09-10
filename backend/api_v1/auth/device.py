"""Отпечаток устройства входа: нужен для 2FA на новых устройствах и списка сессий.

Собираем минимум: sha256 от User-Agent (подпись устройства), сам User-Agent для
человекочитаемой подписи в письме/списке сессий и IP-адрес последнего входа.
Никаких «уникальных идентификаторов» браузера (canvas/fingerprint) не собираем.

ВАЖНО про cookie/подпись: подпись считается только по User-Agent, поэтому:
- обновление браузера (новая версия в UA) выглядит как новое устройство —
  владелец получит код подтверждения и письмо; это осознанный компромисс:
  лучше лишняя проверка, чем пропущенный чужой вход;
- запросы без User-Agent (скрипты, старые клиенты) дают одну общую подпись —
  такие клиенты считаются «тем же устройством» между собой.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from fastapi import Request

from api_v1.rate_limit import client_ip

# Длина User-Agent, которую вообще имеет смысл хранить (в БД колонка String(255)).
MAX_USER_AGENT_LENGTH = 255


@dataclass(frozen=True)
class DeviceInfo:
    """Сведения об устройстве, с которого выполняется вход."""

    signature: str
    user_agent: str
    ip: str

    @property
    def label(self) -> str:
        """Человекочитаемая подпись для писем и списка сессий."""
        return self.user_agent.strip() or "неизвестное устройство"


def device_signature(request: Request | None) -> str:
    """SHA-256 от User-Agent — подпись устройства для 2FA и уведомлений."""
    agent = ""
    if request is not None:
        agent = request.headers.get("user-agent", "")[:MAX_USER_AGENT_LENGTH]
    return hashlib.sha256(agent.encode("utf-8", "replace")).hexdigest()


def device_info(request: Request | None) -> DeviceInfo:
    """Собирает DeviceInfo из запроса (для записей в БД и писем)."""
    agent = ""
    ip = ""
    if request is not None:
        agent = request.headers.get("user-agent", "")[:MAX_USER_AGENT_LENGTH]
        ip = client_ip(request)
    return DeviceInfo(signature=device_signature(request), user_agent=agent, ip=ip)


__all__ = [
    "MAX_USER_AGENT_LENGTH",
    "DeviceInfo",
    "device_info",
    "device_signature",
]
