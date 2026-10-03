"""Отправка push-уведомлений через сервис RuStore (альтернатива FCM).

RuStore предоставляет собственный push-сервис: уведомления доставляются
приложениями экосистемы (RuStore, VK-приложения), а не Google-сервисами.

Формат запроса совместим с FCM:

    POST {api_url}/projects/{project_id}/messages:send
    Authorization: Bearer {service-token}
    {"message": {"token": "...", "notification": {...}, "data": {...},
                 "android": {"ttl": "3600s", "notification": {...}}}}

ID проекта и сервисный токен берутся в RuStore Консоль → Push-уведомления → Проекты
и задаются переменными окружения ``RUSTORE_PUSH_PROJECT_ID`` и
``RUSTORE_PUSH_SERVICE_TOKEN``. Пока они не заданы, канал просто выключен —
Web Push (PWA) при этом работает как обычно.
"""

import json
import logging
import urllib.error
import urllib.request
from typing import Any

from core.config import settings

logger = logging.getLogger(__name__)

# Результат отправки на один токен.
STATUS_OK = "ok"
STATUS_INVALID_TOKEN = "invalid-token"  # токен устарел/некорректен — удаляем
STATUS_AUTH_ERROR = "auth-error"  # неверный сервисный токен/ID проекта
STATUS_ERROR = "error"  # сеть, таймаут, прочее


class RuStorePushError(Exception):
    """Ошибка отправки push через RuStore (не считается фатальной)."""


def is_configured() -> bool:
    """Настроен ли канал RuStore Push (есть ID проекта и сервисный токен)."""
    return bool(
        settings.rustore_push_project_id and settings.rustore_push_service_token
    )


def send(token: str, message: dict[str, Any]) -> str:
    """Отправляет одно сообщение на один токен.

    ``message`` — словарь без ``token`` (notification/data/android); токен
    подставляется здесь. Возвращает один из ``STATUS_*``.
    """
    project_id = settings.rustore_push_project_id
    service_token = settings.rustore_push_service_token
    if not project_id or not service_token:
        return STATUS_ERROR

    body = json.dumps(
        {"message": {**message, "token": token}}, ensure_ascii=False
    ).encode("utf-8")
    api_url = settings.rustore_push_api_url.rstrip("/")
    url = f"{api_url}/projects/{project_id}/messages:send"
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {service_token}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )

    try:
        with urllib.request.urlopen(
            request, timeout=settings.rustore_push_timeout
        ) as response:
            response.read()
        return STATUS_OK
    except urllib.error.HTTPError as exc:
        payload = ""
        try:
            payload = exc.read().decode("utf-8", "replace")
        except Exception:  # тело ответа не критично
            payload = ""
        if exc.code in (401, 403):
            logger.warning(
                "RuStore Push: проблема авторизации (%s): %s", exc.code, payload
            )
            return STATUS_AUTH_ERROR
        if exc.code == 404:
            # Не найден токен устройства — его нужно удалить.
            return STATUS_INVALID_TOKEN
        if exc.code == 400 and "token" in payload.lower():
            return STATUS_INVALID_TOKEN
        logger.warning("RuStore Push: ошибка %s: %s", exc.code, payload)
        return STATUS_ERROR
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        logger.warning("RuStore Push: не удалось отправить (%s)", exc)
        return STATUS_ERROR
