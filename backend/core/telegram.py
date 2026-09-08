"""HTTP-клиенты Telegram для доставки OTP.

Два канала:

* **Telegram Gateway** (основной, ``TELEGRAM_GATEWAY_TOKEN``) — официальный API:
  отправляет верификационное сообщение на номер телефона пользователя в Telegram.
* **Обычный Telegram-бот** (резервный, ``TELEGRAM_BOT_TOKEN``) — код приходит в
  личку пользователю, который заранее «привязал» свой чат к аккаунту через
  ``/start bind_<код>`` (см. ``tasks/telegram.py``).

Клиент синхронный (на urllib) — вызывается из Celery-воркера (prefork), где нет
постоянного event loop. Любые ошибки сети/API поднимаются как
``TelegramApiError``, чтобы вызывающий мог переключиться на запасной канал.
"""

import json
import logging
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from core.config import settings

logger = logging.getLogger(__name__)

TG_API_URL = "https://api.telegram.org"
_HTTP_TIMEOUT = 10


class TelegramApiError(Exception):
    """Ошибка обращения к Telegram (Gateway или Bot API)."""


def _post_json(
    url: str,
    payload: dict[str, Any],
    *,
    token: str | None = None,
) -> dict[str, Any]:
    """POST JSON и возврат ответа; при сетевой/HTTP-ошибке — TelegramApiError."""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
    try:
        with urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "replace")
        except Exception:  # noqa: BLE001 — тело может быть недоступно
            pass
        raise TelegramApiError(f"HTTP {exc.code}: {detail}".strip()) from exc
    except (URLError, OSError, json.JSONDecodeError) as exc:
        raise TelegramApiError(str(exc)) from exc


# --------------------------------------------------------------------------
# Telegram Gateway
# --------------------------------------------------------------------------
def gateway_send_verification(phone_number: str, code: str, ttl_seconds: int) -> str:
    """Отправляет верификационный код на телефон через Telegram Gateway.

    Возвращает ``request_id`` (можно использовать для последующего
    ``checkVerificationStatus``). При любой ошибке — ``TelegramApiError``.
    """
    token = settings.telegram_gateway_token
    if not token:
        raise TelegramApiError("TELEGRAM_GATEWAY_TOKEN не задан")
    base = settings.telegram_gateway_base_url.rstrip("/")
    payload = {
        # Gateway ожидает номер в международном формате (без '+').
        "phone_number": phone_number.lstrip("+"),
        # Код генерируем сами (6 цифр), поэтому передаём его явно.
        "code": code,
        # TTL кода в секундах — согласуем со сроком жизни OTP в БД.
        "code_ttl": ttl_seconds,
    }
    data = _post_json(f"{base}/api/v1/sendVerificationMessage", payload, token=token)
    if data.get("ok") is False:
        raise TelegramApiError(f"Gateway: {data}")
    result = data.get("result") or data
    request_id = result.get("request_id") if isinstance(result, dict) else None
    if not request_id:
        raise TelegramApiError(f"Gateway: нет request_id в ответе: {data}")
    return str(request_id)


# --------------------------------------------------------------------------
# Обычный Telegram-бот (Bot API)
# --------------------------------------------------------------------------
def _bot_url(method: str) -> str:
    token = settings.telegram_bot_token
    if not token:
        raise TelegramApiError("TELEGRAM_BOT_TOKEN не задан")
    return f"{TG_API_URL}/bot{token}/{method}"


def bot_send_message(chat_id: int, text: str) -> None:
    """Отправляет сообщение в чат бота."""
    data = _post_json(_bot_url("sendMessage"), {"chat_id": chat_id, "text": text})
    if data.get("ok") is not True:
        raise TelegramApiError(f"Bot sendMessage: {data}")


def bot_get_updates(offset: int | None = None, timeout: int = 5) -> list[dict]:
    """Забирает апдейты бота (long polling, ``timeout`` — у сервера Telegram)."""
    payload: dict[str, Any] = {
        "timeout": timeout,
        "allowed_updates": ["message"],
    }
    if offset is not None:
        payload["offset"] = offset
    data = _post_json(_bot_url("getUpdates"), payload)
    if data.get("ok") is not True:
        raise TelegramApiError(f"Bot getUpdates: {data}")
    return data.get("result") or []
