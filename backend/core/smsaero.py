"""HTTP-клиент SMS-шлюза SMS Aero для доставки OTP-кодов.

Основной канал доставки кодов входа (по телефону). Используется, когда заданы
``SMS_AERO_EMAIL`` и ``SMS_AERO_API_KEY`` (аккаунт https://smsaero.ru). Если ключ
не задан — воркер пишет код в лог (dev-режим), см. ``tasks/otp_tasks.py``.

API v2: ``GET {base}/v2/sms/send?number=..&text=..&sign=..``, авторизация —
HTTP Basic (email : api-key). Клиент синхронный (на urllib), т.к. вызывается из
Celery-воркера (prefork), где нет постоянного event loop. Любые ошибки
сети/API поднимаются как ``SmsAeroError``.
"""

import base64
import json
import logging
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from core.config import settings

logger = logging.getLogger(__name__)

_HTTP_TIMEOUT = 10


class SmsAeroError(Exception):
    """Ошибка обращения к SMS Aero."""


def _get_json(url: str, credentials: str) -> dict[str, Any]:
    """GET с Basic-авторизацией; при сетевой/HTTP-ошибке — SmsAeroError."""
    req = Request(url, headers={"Accept": "application/json"})
    req.add_header("Authorization", "Basic " + credentials)
    try:
        with urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "replace")
        except Exception:  # noqa: BLE001 - тело может быть недоступно
            pass
        raise SmsAeroError(f"HTTP {exc.code}: {detail}".strip()) from exc
    except (URLError, OSError, json.JSONDecodeError) as exc:
        raise SmsAeroError(str(exc)) from exc


def send_sms(phone_number: str, text: str) -> str:
    """Отправляет SMS-сообщение через SMS Aero.

    Возвращает id сообщения из ответа. При отсутствии ключей или любой ошибке —
    ``SmsAeroError`` (вызывающий решает, что делать: fallback/лог).
    """
    email = settings.sms_aero_email
    api_key = settings.sms_aero_api_key
    if not email or not api_key:
        raise SmsAeroError("SMS_AERO_EMAIL / SMS_AERO_API_KEY не заданы")

    base = settings.sms_aero_base_url.rstrip("/")
    params: dict[str, str] = {
        # Номер в международном формате без '+'.
        "number": phone_number.lstrip("+"),
        "text": text,
        "channel": "DIRECT",
    }
    if settings.sms_aero_sign:
        params["sign"] = settings.sms_aero_sign
    url = f"{base}/v2/sms/send?{urlencode(params)}"

    credentials = base64.b64encode(f"{email}:{api_key}".encode("utf-8")).decode("ascii")
    data = _get_json(url, credentials)
    if not data.get("success"):
        raise SmsAeroError(f"SMS Aero: {data}")
    result = data.get("data") or {}
    return str(result.get("id") or "")
