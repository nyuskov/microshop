"""Режим технических работ: рубильник в БД и заглушка на запросах к API.

Проверяем то, ради чего режим появился: администратор включает его (из админской
панели или скриптом `scripts/maintenance.py`), после чего обычные запросы
получают 503 с машиночитаемым кодом `maintenance`, и приложение показывает экран
техработ. При этом проверки живости, эндпоинты входа и сам рубильник остаются
доступными — иначе владелец не смог бы выключить режим без ssh, а мониторинг
принял бы плановые работы за упавший сервис.

Запускается только при заданном TEST_DATABASE_URL (как остальные БД-тесты).
"""

from __future__ import annotations

import json
import os
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import maintenance
from core.models import AppSetting, User, db_helper

pytestmark = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


class _ApiCtx:
    """Контекст API-теста: клиент, фабрика сессий и хелперы."""

    def __init__(self, client: AsyncClient, factory: async_sessionmaker) -> None:
        self.client = client
        self.factory = factory

    async def make_user(self, *, admin: bool = False, owner: bool = False) -> User:
        async with self.factory() as session:
            user = User(
                username=f"user_{uuid.uuid4().hex[:10]}",
                hashed_password="x",
                is_active=True,
                is_admin=admin,
                is_superuser=owner,
                is_verified=False,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            return user

    async def token_for(self, user: User) -> str:
        from api_v1.auth.jwt import get_jwt_strategy

        return await get_jwt_strategy().write_token(user)

    def auth(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    async def switch(self, *, enabled: bool, message: str | None = None) -> None:
        """Переключает режим напрямую в БД (как это делает админ-эндпоинт)."""
        async with self.factory() as session:
            await maintenance.write_state(session, enabled=enabled, message=message)

    async def raw_setting(self) -> AppSetting | None:
        async with self.factory() as session:
            return await session.get(AppSetting, maintenance.MAINTENANCE_KEY)


@pytest.fixture(autouse=True)
def reset_maintenance_cache():
    """Между тестами состояние в памяти процесса не должно переноситься."""
    maintenance.invalidate_cache()
    yield
    maintenance.invalidate_cache()


@pytest_asyncio.fixture
async def api(monkeypatch) -> _ApiCtx:
    """httpx-клиент поверх приложения с тестовой БД (таблицы чистятся до теста)."""
    engine = create_async_engine(os.environ["TEST_DATABASE_URL"])

    async with engine.begin() as conn:
        table_names = (
            (
                await conn.execute(
                    text(
                        "SELECT tablename FROM pg_tables "
                        "WHERE schemaname = 'public' AND tablename <> 'alembic_version'"
                    )
                )
            )
            .scalars()
            .all()
        )
        if table_names:
            quoted = ", ".join(f'"public"."{name}"' for name in table_names)
            await conn.execute(text(f"TRUNCATE TABLE {quoted} CASCADE"))

    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _override_session():
        async with factory() as session:
            yield session

    from main import app

    # Заглушка техработ читает состояние через `db_helper.session_factory`
    # напрямую (не через Depends) — подменяем и её.
    monkeypatch.setattr(db_helper, "session_factory", factory)
    app.dependency_overrides[db_helper.session_dependency] = _override_session

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        try:
            yield _ApiCtx(client, factory)
        finally:
            app.dependency_overrides.clear()
            await engine.dispose()


async def test_off_by_default(api: _ApiCtx) -> None:
    """Пустая таблица настроек — режим выключен и текст по умолчанию."""
    async with api.factory() as session:
        state = await maintenance.read_state(session)

    assert state.enabled is False
    assert state.message == maintenance.DEFAULT_MESSAGE
    assert state.since is None

    response = await api.client.get("/api/v1/system/maintenance/")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "enabled": False,
        "message": maintenance.DEFAULT_MESSAGE,
        "since": None,
        # Поле для администратора: у остальных оно приходит как null и клиентом
        # игнорируется (`actual_enabled ?? enabled`).
        "actual_enabled": None,
    }


async def test_switch_persists_state(api: _ApiCtx) -> None:
    """Включение сохраняется в БД вместе с автором и временем переключения."""
    owner = await api.make_user(owner=True)
    token = await api.token_for(owner)

    response = await api.client.put(
        "/api/v1/system/maintenance/",
        json={"enabled": True, "message": "Обновляем сервис, вернёмся к 15:00"},
        headers=api.auth(token),
    )
    assert response.status_code == 200, response.text

    async with api.factory() as session:
        state = await maintenance.read_state(session)
    assert state.enabled is True
    assert state.message == "Обновляем сервис, вернёмся к 15:00"
    assert state.since is not None

    row = await api.raw_setting()
    assert row is not None
    assert row.updated_by_user_id == owner.id
    payload = json.loads(row.value)
    assert payload["enabled"] is True
    assert payload["message"] == "Обновляем сервис, вернёмся к 15:00"
    assert payload["by"] == owner.id


async def test_empty_message_falls_back_to_default(api: _ApiCtx) -> None:
    """Пустой текст не оставляет людей без объяснения."""
    await api.switch(enabled=True, message="   ")

    response = await api.client.get("/api/v1/system/maintenance/")
    assert response.json()["message"] == maintenance.DEFAULT_MESSAGE


async def test_broken_setting_is_treated_as_disabled(api: _ApiCtx) -> None:
    """Мусор в настройке не должен «залипать» включённым режимом."""
    async with api.factory() as session:
        session.add(AppSetting(key=maintenance.MAINTENANCE_KEY, value="{не json"))
        await session.commit()

    async with api.factory() as session:
        state = await maintenance.read_state(session)

    assert state.enabled is False
    assert state.message == maintenance.DEFAULT_MESSAGE


async def test_toggle_requires_owner(api: _ApiCtx) -> None:
    """Переключать режим может только ВЛАДЕЛЕЦ: администратору — 403.

    Роль администратора даёт модерацию, приглашения и обход заглушки, но не
    рубильник: включить техработы значит остановить сервис для всех.
    """
    user = await api.make_user()
    admin = await api.make_user(admin=True)
    admin_token = await api.token_for(admin)
    token = await api.token_for(user)

    anonymous = await api.client.put(
        "/api/v1/system/maintenance/", json={"enabled": True}
    )
    assert anonymous.status_code == 401, anonymous.text

    forbidden = await api.client.put(
        "/api/v1/system/maintenance/", json={"enabled": True}, headers=api.auth(token)
    )
    assert forbidden.status_code == 403, forbidden.text

    # Администратор — тоже не владелец: рубильник ему недоступен.
    admin_forbidden = await api.client.put(
        "/api/v1/system/maintenance/",
        json={"enabled": True},
        headers=api.auth(admin_token),
    )
    assert admin_forbidden.status_code == 403, admin_forbidden.text

    response = await api.client.get("/api/v1/system/maintenance/")
    assert response.json()["enabled"] is False


async def test_owner_switches_mode_from_the_app(api: _ApiCtx) -> None:
    """Владелец включает и выключает режим теми же эндпоинтами, что и панель."""
    owner = await api.make_user(owner=True)
    token = await api.token_for(owner)

    enabled = await api.client.put(
        "/api/v1/system/maintenance/",
        json={"enabled": True, "message": "Обновляем сервис"},
        headers=api.auth(token),
    )
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["enabled"] is True
    assert enabled.json()["message"] == "Обновляем сервис"
    assert enabled.json()["since"] is not None

    # Публичный статус виден и без входа: по нему клиент рисует экран техработ.
    status = await api.client.get("/api/v1/system/maintenance/")
    assert status.status_code == 200
    assert status.json()["enabled"] is True

    disabled = await api.client.put(
        "/api/v1/system/maintenance/", json={"enabled": False}, headers=api.auth(token)
    )
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["enabled"] is False


async def test_regular_requests_are_blocked_while_enabled(api: _ApiCtx) -> None:
    """Пока режим включён, обычные запросы к API получают 503 с кодом maintenance."""
    user = await api.make_user()
    token = await api.token_for(user)
    await api.switch(enabled=True, message="Обновляем сервис")

    blocked = await api.client.get("/api/v1/chats/", headers=api.auth(token))
    assert blocked.status_code == 503, blocked.text
    detail = blocked.json()["detail"]
    assert detail["code"] == maintenance.MAINTENANCE_CODE
    assert detail["message"] == "Обновляем сервис"
    # Клиенту подсказано, когда вернуться (приложение опрашивает статус само).
    assert blocked.headers["Retry-After"] == "300"

    # Без токена — тоже 503 (а не 401): режим важнее авторизации.
    anonymous = await api.client.get("/api/v1/chats/")
    assert anonymous.status_code == 503


async def test_liveness_status_and_login_stay_available(api: _ApiCtx) -> None:
    """Мониторинг и вход продолжают работать: иначе режим нечем выключить."""
    await api.switch(enabled=True)

    for path in ("/health", "/api/v1/health", "/api/v1/system/maintenance/"):
        response = await api.client.get(path)
        assert response.status_code == 200, f"{path}: {response.text}"

    channels = await api.client.get("/api/v1/auth/channels/")
    assert channels.status_code == 200, channels.text


async def test_admin_and_owner_pass_through(api: _ApiCtx) -> None:
    """Заглушка не мешает ни администратору, ни владельцу; обычному — 503."""
    admin = await api.make_user(admin=True)
    owner = await api.make_user(owner=True)
    regular = await api.make_user()
    admin_token = await api.token_for(admin)
    owner_token = await api.token_for(owner)
    regular_token = await api.token_for(regular)
    await api.switch(enabled=True)

    for token in (admin_token, owner_token):
        allowed = await api.client.get("/api/v1/chats/", headers=api.auth(token))
        assert allowed.status_code == 200, allowed.text

    blocked = await api.client.get("/api/v1/chats/", headers=api.auth(regular_token))
    assert blocked.status_code == 503, blocked.text


async def test_broken_token_does_not_open_access(api: _ApiCtx) -> None:
    """Поддельный или refresh-токен доступа не открывает."""
    await api.switch(enabled=True)

    fake = await api.client.get(
        "/api/v1/chats/", headers={"Authorization": "Bearer not-a-token"}
    )
    assert fake.status_code == 503, fake.text


async def test_admin_does_not_see_the_screen(api: _ApiCtx) -> None:
    """Администратору публичный статус говорит «режим выключен».

    Иначе заглушка вылезала бы и у него — в том числе в старом клиенте (кэш PWA,
    ещё не обновлённое приложение Android), который о ролях ничего не знает:
    решение «показывать ли экран» он принимает по этому самому ответу. Настоящее
    состояние сервер отдаёт отдельным полем — по нему админская панель рисует
    переключатель.
    """
    admin = await api.make_user(admin=True)
    token = await api.token_for(admin)
    await api.switch(enabled=True)

    response = await api.client.get(
        "/api/v1/system/maintenance/", headers=api.auth(token)
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["enabled"] is False
    assert body["actual_enabled"] is True


async def test_owner_sees_real_state_too(api: _ApiCtx) -> None:
    """Владелец получает то же: он тоже работает во время техработ."""
    owner = await api.make_user(owner=True)
    token = await api.token_for(owner)
    await api.switch(enabled=True)

    body = (
        await api.client.get("/api/v1/system/maintenance/", headers=api.auth(token))
    ).json()
    assert (body["enabled"], body["actual_enabled"]) == (False, True)


async def test_regular_user_gets_plain_status(api: _ApiCtx) -> None:
    """Обычному пользователю заглушку показываем: `enabled=true`, без лишних полей."""
    regular = await api.make_user()
    token = await api.token_for(regular)
    await api.switch(enabled=True)

    body = (
        await api.client.get("/api/v1/system/maintenance/", headers=api.auth(token))
    ).json()
    assert body["enabled"] is True
    # Настоящее состояние — только у админов; у остальных поля нет (или null).
    assert body.get("actual_enabled") is None
