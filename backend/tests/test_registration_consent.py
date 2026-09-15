"""Согласие с документами сервиса при регистрации.

Регистрация — единственная точка, где спрашивается согласие (галка на экране
входа; при обычном входе её нет). Проверяем:

  * поле ``accept_terms`` НЕобязательное — старые сборки приложения его не
    присылают, и регистрация не должна из-за этого падать;
  * при ``accept_terms=true`` факт согласия попадает в журнал безопасности:
    именно этой записью согласие можно подтвердить позже (152-ФЗ), а не текстом
    под кнопкой;
  * в записи названы все документы, а не безликое «согласие получено».

Интеграционная часть требует PostgreSQL (``TEST_DATABASE_URL``), см. conftest.
"""

from sqlalchemy import select
from starlette.datastructures import Headers
from starlette.requests import Request

from api_v1.auth import audit
from api_v1.auth.routers.invites import InviteRegisterRequest
from api_v1.auth.routers.password import register_with_password
from api_v1.auth.schemas import PasswordRegisterRequest, VerifyOTPRequest
from core.config import settings
from core.models import SecurityEvent

#: Пароль, проходящий серверную политику (длина, без повторов и последовательностей).
STRONG_PASSWORD = "Snegopad-Vesna-7x"


def _request() -> Request:
    """Минимальный ASGI-scope: эндпоинтам нужен IP для лимитов и журнала."""
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/auth/password/register/",
        "headers": Headers().raw,
        "query_string": b"",
        "client": ("127.0.0.1", 12345),
    }
    return Request(  # type: ignore[arg-type]
        scope, receive=lambda: None, send=lambda message: None
    )


# --- Чистые проверки схем и текста записи -------------------------------


def test_accept_terms_is_optional_for_old_clients() -> None:
    """Поле необязательное: иначе Android-приложение перестало бы регистрировать."""
    assert (
        VerifyOTPRequest(phone_number="+79001110001", otp="1234").accept_terms is False
    )
    assert (
        PasswordRegisterRequest(phone_number="+79001110001", password="x").accept_terms
        is False
    )
    assert (
        InviteRegisterRequest(phone_number="+79001110001", password="x").accept_terms
        is False
    )


def test_accept_terms_is_parsed() -> None:
    request_data = PasswordRegisterRequest(
        phone_number="+79001110001", password="x", accept_terms=True
    )

    assert request_data.accept_terms is True


def test_terms_detail_lists_every_document() -> None:
    """В журнале должно быть видно, ЧТО именно человек принял."""
    detail = audit.TERMS_DETAIL

    for part in ("политик", "соглашени", "правил", "персональных данных"):
        assert part in detail
    assert audit.EVENT_TITLES["terms_accepted"]


async def _consent_events(session) -> list[SecurityEvent]:
    result = await session.execute(
        select(SecurityEvent).where(SecurityEvent.event == "terms_accepted")
    )
    return list(result.scalars().all())


# --- Интеграционные проверки (нужен PostgreSQL) -------------------------


async def test_registration_writes_consent_to_security_log(
    session, monkeypatch
) -> None:
    """Регистрация с галкой: согласие видно в журнале безопасности."""
    # Рубильник публичной регистрации в тестовом окружении может быть выключен —
    # он тут не про согласие, поэтому включаем явно.
    monkeypatch.setattr(settings, "registration_enabled", True)
    response = await register_with_password(
        request_data=PasswordRegisterRequest(
            phone_number="+79001110042",
            password=STRONG_PASSWORD,
            accept_terms=True,
        ),
        request=_request(),
        session=session,
    )

    assert response.access_token
    events = await _consent_events(session)
    assert len(events) == 1
    assert events[0].user_id is not None
    assert audit.TERMS_DETAIL in events[0].detail


async def test_registration_without_consent_writes_nothing(
    session, monkeypatch
) -> None:
    """Регистрация без галки (старый клиент): аккаунт создаётся, записи нет."""
    monkeypatch.setattr(settings, "registration_enabled", True)
    response = await register_with_password(
        request_data=PasswordRegisterRequest(
            phone_number="+79001110043",
            password=STRONG_PASSWORD,
        ),
        request=_request(),
        session=session,
    )

    assert response.access_token
    assert await _consent_events(session) == []
