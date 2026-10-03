"""HTTP-клиент SMS-шлюза SMS Aero для доставки OTP-кодов.

Основной канал доставки кодов входа (по телефону). Используется, когда заданы
``SMS_AERO_EMAIL`` и ``SMS_AERO_API_KEY`` (аккаунт https://smsaero.ru). Если ключ
не задан — воркер пишет код в лог (dev-режим), см. ``tasks/otp_tasks.py``.

API v2: ``GET {base}/v2/sms/send?number=..&text=..&sign=..``, авторизация —
HTTP Basic (email : api-key), базовый адрес — ``https://gate.smsaero.ru``.
Клиент синхронный (на urllib), т.к. вызывается из Celery-воркера (prefork), где
нет постоянного event loop. Любые ошибки сети/API поднимаются как
``SmsAeroError``.
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

# Бесплатная подпись SMS Aero: работает без регистрации, но тариф на неё дороже
# (у отдельных операторов — в разы). Свою подпись регистрируют в кабинете.
_FREE_SIGN = "SMS Aero"


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
        except Exception:  # тело может быть недоступно
            pass
        raise SmsAeroError(f"HTTP {exc.code}: {detail}".strip()) from exc
    except (URLError, OSError, json.JSONDecodeError) as exc:
        raise SmsAeroError(str(exc)) from exc


def _warn_if_moderated(result: dict[str, Any]) -> None:
    """Предупреждает, если шлюз принял сообщение только в модерацию.

    Ответ API может быть ``success: true``, а сообщение при этом уйдёт
    модератору (``status=8``, ``extendStatus=moderation``) и позже может быть
    отклонено (``status=6``, например «Необходимо заключить договор»). Без
    договора с SMS Aero так отклоняется вообще всё, поэтому такая запись в логе
    — первый признак, что канал не работает, хотя ошибки API нет.
    """
    status_code = result.get("status")
    extend_status = str(result.get("extendStatus") or "")
    if status_code == 8 or extend_status == "moderation":
        logger.warning(
            "SMS Aero принял сообщение id=%s в модерацию — доставка не гарантирована "
            "(при отсутствии договора/согласий сообщение отклоняется)",
            result.get("id"),
        )


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
        # Подпись обязательна для API. Пустая переменная окружения (типичный
        # случай в compose) тоже ведёт к бесплатной подписи «SMS Aero».
        "sign": settings.sms_aero_sign or _FREE_SIGN,
    }
    url = f"{base}/v2/sms/send?{urlencode(params)}"

    credentials = base64.b64encode(f"{email}:{api_key}".encode("utf-8")).decode("ascii")
    data = _get_json(url, credentials)
    if not data.get("success"):
        raise SmsAeroError(f"SMS Aero: {data}")
    result = data.get("data") or {}
    _warn_if_moderated(result)
    return str(result.get("id") or "")


def send_telegram_code(phone_number: str, code: str, sms_text: str) -> str:
    """Отправляет код в Telegram через SMS Aero (с откатом на SMS).

    Канал «Коды в Telegram» — самый дешёвый способ доставить OTP (2,49 ₽ против
    ~9 ₽ за SMS на этом тарифе). Передаём ``text`` и ``sign`` — тогда шлюз
    работает каскадом: если Telegram не доставить (у абонента нет аккаунта на
    этот номер), автоматически уходит обычное SMS, то есть доставка не теряется.

    ВАЖНО: доставляет код инфраструктура SMS Aero, нашему серверу доступ к
    Telegram НЕ нужен (на прод-VM api.telegram.org недоступен).

    Возвращает id запроса; при ошибке — ``SmsAeroError``.
    """
    email = settings.sms_aero_email
    api_key = settings.sms_aero_api_key
    if not email or not api_key:
        raise SmsAeroError("SMS_AERO_EMAIL / SMS_AERO_API_KEY не заданы")
    digits = "".join(ch for ch in code if ch.isdigit())
    if not 4 <= len(digits) <= 8:
        raise SmsAeroError("Код для Telegram должен содержать 4–8 цифр")

    base = settings.sms_aero_base_url.rstrip("/")
    params: dict[str, str] = {
        "number": phone_number.lstrip("+"),
        "code": digits,
        # text/sign включают каскад «код в Telegram → SMS при недоставке».
        "text": sms_text,
        "sign": settings.sms_aero_sign or _FREE_SIGN,
    }
    url = f"{base}/v2/telegram/send?{urlencode(params)}"

    credentials = base64.b64encode(f"{email}:{api_key}".encode("utf-8")).decode("ascii")
    data = _get_json(url, credentials)
    if not data.get("success"):
        raise SmsAeroError(f"SMS Aero: {data}")
    result = data.get("data") or {}
    _warn_if_moderated(result)
    return str(result.get("id") or "")
