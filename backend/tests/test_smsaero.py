"""Тесты клиента SMS Aero: адрес API, подпись, разбор ответа.

Ключевые вещи, которые здесь фиксируются (обе уже один раз ломались):
  1) базовый адрес API — ``https://gate.smsaero.ru`` (хост ``gateway.smsaero.ru``
     больше не существует, из-за него отправка молча падала в dev-лог);
  2) параметр ``sign`` обязателен для ``/v2/sms/send`` и должен подставляться
     даже когда переменная окружения пустая (типичный случай в compose).
"""

import base64
from urllib.parse import parse_qs, urlparse

import pytest

from core import smsaero
from core.config import Settings, settings


def _credentials(email: str, api_key: str) -> str:
    """Basic-креды так, как их формирует клиент."""
    return base64.b64encode(f"{email}:{api_key}".encode("utf-8")).decode("ascii")


@pytest.fixture
def sms_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Задаёт рабочие креды SMS Aero в настройках приложения."""
    monkeypatch.setattr(settings, "sms_aero_email", "login@example.com")
    monkeypatch.setattr(settings, "sms_aero_api_key", "api-key")


def test_default_base_url_is_gate_host() -> None:
    """Дефолт адреса API — актуальный gate.smsaero.ru."""
    default = Settings.model_fields["sms_aero_base_url"].default
    assert default == "https://gate.smsaero.ru"


def test_send_sms_uses_documented_request(
    monkeypatch: pytest.MonkeyPatch, sms_settings: None
) -> None:
    """Запрос уходит на /v2/sms/send с номером, текстом и подписью."""
    monkeypatch.setattr(settings, "sms_aero_base_url", "https://gate.smsaero.ru")
    monkeypatch.setattr(settings, "sms_aero_sign", "")
    captured: dict[str, str] = {}

    def fake_get_json(url: str, credentials: str) -> dict[str, object]:
        captured["url"] = url
        captured["credentials"] = credentials
        return {"success": True, "data": {"id": 123}}

    monkeypatch.setattr(smsaero, "_get_json", fake_get_json)

    message_id = smsaero.send_sms("+79991234567", "Код: 000000")

    assert message_id == "123"
    parsed = urlparse(captured["url"])
    assert parsed.path == "/v2/sms/send"
    query = parse_qs(parsed.query)
    assert query["number"] == ["79991234567"]
    assert query["text"] == ["Код: 000000"]
    # Пустая настройка не означает «без подписи»: API требует sign всегда.
    assert query["sign"] == [smsaero._FREE_SIGN]
    # Канал отправки задаётся тарифом/подписью, а не параметром запроса.
    assert "channel" not in query
    assert captured["credentials"] == _credentials("login@example.com", "api-key")


def test_send_sms_uses_configured_sign(
    monkeypatch: pytest.MonkeyPatch, sms_settings: None
) -> None:
    """Своя подпись из настроек важнее бесплатной."""
    monkeypatch.setattr(settings, "sms_aero_sign", "Pismo")
    captured: dict[str, str] = {}

    def fake_get_json(url: str, credentials: str) -> dict[str, object]:
        captured["url"] = url
        return {"success": True, "data": {"id": 1}}

    monkeypatch.setattr(smsaero, "_get_json", fake_get_json)

    smsaero.send_sms("+79991234567", "text")

    assert parse_qs(urlparse(captured["url"]).query)["sign"] == ["Pismo"]


def test_send_telegram_code_uses_cascade(
    monkeypatch: pytest.MonkeyPatch, sms_settings: None
) -> None:
    """Код уходит в Telegram, а text/sign включают откат на SMS при недоставке."""
    captured: dict[str, str] = {}

    def fake_get_json(url: str, credentials: str) -> dict[str, object]:
        captured["url"] = url
        return {"success": True, "data": {"id": 42}}

    monkeypatch.setattr(smsaero, "_get_json", fake_get_json)

    request_id = smsaero.send_telegram_code(
        "+79991234567", "000123", "Pismo: код 000123"
    )

    assert request_id == "42"
    parsed = urlparse(captured["url"])
    assert parsed.path == "/v2/telegram/send"
    query = parse_qs(parsed.query)
    assert query["number"] == ["79991234567"]
    assert query["code"] == ["000123"]
    # Без text/sign шлюз не сможет отправить SMS, если Telegram недоставим.
    assert query["text"] == ["Pismo: код 000123"]
    assert query["sign"] == [smsaero._FREE_SIGN]


def test_send_telegram_code_requires_digits(
    monkeypatch: pytest.MonkeyPatch, sms_settings: None
) -> None:
    """Telegram принимает только код из 4–8 цифр — иначе ошибка без запроса."""
    monkeypatch.setattr(
        smsaero, "_get_json", lambda url, credentials: {"success": True, "data": {}}
    )

    with pytest.raises(smsaero.SmsAeroError):
        smsaero.send_telegram_code("+79991234567", "12", "text")


def test_send_sms_requires_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    """Без логина/ключа клиент не ходит в сеть, а сообщает об ошибке."""
    monkeypatch.setattr(settings, "sms_aero_email", None)
    monkeypatch.setattr(settings, "sms_aero_api_key", None)

    with pytest.raises(smsaero.SmsAeroError):
        smsaero.send_sms("+79991234567", "text")


def test_send_sms_reports_api_failure(
    monkeypatch: pytest.MonkeyPatch, sms_settings: None
) -> None:
    """Ответ success=false превращается в SmsAeroError (воркер уйдёт в fallback)."""
    monkeypatch.setattr(
        smsaero,
        "_get_json",
        lambda url, credentials: {"success": False, "message": "sign not found"},
    )

    with pytest.raises(smsaero.SmsAeroError):
        smsaero.send_sms("+79991234567", "text")


def test_send_sms_warns_when_message_goes_to_moderation(
    monkeypatch: pytest.MonkeyPatch,
    sms_settings: None,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Модерация шлюза (status=8) без ошибки API — предупреждение в лог.

    Так выглядит рабочая отправка без договора с SMS Aero: ответ success=true,
    сообщение уходит модератору и затем отклоняется, поэтому код не дойдёт.
    """
    monkeypatch.setattr(
        smsaero,
        "_get_json",
        lambda url, credentials: {
            "success": True,
            "data": {"id": 7, "status": 8, "extendStatus": "moderation"},
        },
    )

    with caplog.at_level("WARNING", logger="core.smsaero"):
        message_id = smsaero.send_sms("+79991234567", "text")

    assert message_id == "7"
    assert "модерацию" in caplog.text
