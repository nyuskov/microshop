"""Выдача приглашений владельцем: список, создание, отзыв.

Проверяем то, ради чего раздел «Приглашения» появился в приложении: ссылку
можно создать и погасить, не заходя на сервер по ssh, и сделать это может
только аккаунт с флагом администратора. Публичная часть (регистрация по ссылке)
проверяется в test_registration_consent.py.

Интеграционная часть требует PostgreSQL (``TEST_DATABASE_URL``), см. conftest.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from starlette.datastructures import Headers
from starlette.requests import Request

from api_v1.auth.routers.invites import (
    InviteCreateRequest,
    create_invite,
    invite_status,
    list_invites,
    revoke_invite,
)
from core.models import RegistrationInvite, User


def _request() -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/auth/invites/",
        "headers": Headers().raw,
        "query_string": b"",
        "client": ("127.0.0.1", 12345),
    }
    return Request(  # type: ignore[arg-type]
        scope, receive=lambda: None, send=lambda message: None
    )


async def _make_user(session, username: str, *, admin: bool) -> User:
    user = User(
        username=username,
        phone_number=None,
        hashed_password="x",
        is_active=True,
        is_superuser=admin,
        is_verified=False,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _status(session, token: str) -> bool:
    """Публичная проверка ссылки (то, что видит приглашённый по ссылке)."""
    response = await invite_status(token=token, request=_request(), session=session)
    return response.valid


async def test_owner_creates_invite(session) -> None:
    admin = await _make_user(session, "invites_admin", admin=True)

    invite = await create_invite(
        request_data=InviteCreateRequest(note="для Пети", expires_days=7),
        admin=admin,
        session=session,
    )

    assert invite.token
    assert invite.note == "для Пети"
    assert invite.used_at is None and invite.revoked_at is None
    assert invite.expires_at is not None
    assert await _status(session, invite.token) is True


async def test_invite_can_be_bound_to_phone(session) -> None:
    admin = await _make_user(session, "invites_admin2", admin=True)

    invite = await create_invite(
        request_data=InviteCreateRequest(phone_number="+79001110055"),
        admin=admin,
        session=session,
    )

    assert invite.phone_number == "+79001110055"


async def test_bad_phone_and_expiry_rejected(session) -> None:
    admin = await _make_user(session, "invites_admin3", admin=True)

    with pytest.raises(HTTPException) as bad_phone:
        await create_invite(
            request_data=InviteCreateRequest(phone_number="123"),
            admin=admin,
            session=session,
        )
    assert bad_phone.value.status_code == 400

    with pytest.raises(HTTPException) as bad_days:
        await create_invite(
            request_data=InviteCreateRequest(expires_days=0),
            admin=admin,
            session=session,
        )
    assert bad_days.value.status_code == 400


async def test_revoked_invite_stops_working(session) -> None:
    """Отзыв — то, ради чего ссылку можно «погасить» не дожидаясь регистрации."""
    admin = await _make_user(session, "invites_admin4", admin=True)
    invite = await create_invite(
        request_data=InviteCreateRequest(note="отозвать"),
        admin=admin,
        session=session,
    )
    assert await _status(session, invite.token) is True

    await revoke_invite(invite_id=invite.id, admin=admin, session=session)

    assert await _status(session, invite.token) is False
    listed = await list_invites(admin=admin, session=session)
    row = next(item for item in listed.items if item.id == invite.id)
    assert row.revoked_at is not None
    assert listed.active == 0


async def test_revoke_twice_is_rejected(session) -> None:
    admin = await _make_user(session, "invites_admin5", admin=True)
    invite = await create_invite(
        request_data=InviteCreateRequest(),
        admin=admin,
        session=session,
    )
    await revoke_invite(invite_id=invite.id, admin=admin, session=session)

    with pytest.raises(HTTPException) as second:
        await revoke_invite(invite_id=invite.id, admin=admin, session=session)

    assert second.value.status_code == 400


async def test_revoke_unknown_invite_is_404(session) -> None:
    admin = await _make_user(session, "invites_admin6", admin=True)

    with pytest.raises(HTTPException) as missing:
        await revoke_invite(invite_id=999_999, admin=admin, session=session)

    assert missing.value.status_code == 404


async def test_expired_invite_is_not_active(session) -> None:
    """Срок годности считаем на сервере — приглашённый по такой ссылке не пройдёт."""
    admin = await _make_user(session, "invites_admin7", admin=True)
    invite = await create_invite(
        request_data=InviteCreateRequest(),
        admin=admin,
        session=session,
    )

    # Состариваем приглашение вручную: ждать сутки в тесте не вариант.
    row = await session.get(RegistrationInvite, invite.id)
    assert row is not None
    row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await session.commit()

    assert await _status(session, invite.token) is False
