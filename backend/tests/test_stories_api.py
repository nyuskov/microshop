"""HTTP-тесты историй (статусов): публикация, лента, просмотры, удаление.

Запускаются только при заданном ``TEST_DATABASE_URL`` (как остальные БД-тесты;
в CI его даёт сервис postgres). Схема накатывается alembic.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.models import Profile, StoryView, User, UserBlock

pytestmark = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)

#: Минимальный валидный PNG (1×1) — чтобы проверка сигнатуры файла проходила.
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082"
)


class _ApiCtx:
    """Контекст теста: клиент, фабрика сессий и хелперы."""

    def __init__(self, client: object, factory: async_sessionmaker) -> None:
        self.client = client
        self.factory = factory

    async def make_user(self, *, username: str | None = None) -> User:
        async with self.factory() as session:
            user = User(
                username=username or f"user_{uuid.uuid4().hex[:10]}",
                hashed_password="x",
                is_active=True,
                is_superuser=False,
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

    async def publish(self, token: str, *, caption: str = "", name: str = "story.png"):
        return await self.client.post(
            "/api/v1/stories/",
            params={"filename": name, "mime": "image/png", "caption": caption},
            content=PNG_BYTES,
            headers=self.auth(token),
        )

    async def feed(self, token: str) -> list[dict]:
        response = await self.client.get("/api/v1/stories/", headers=self.auth(token))
        assert response.status_code == 200, response.text
        return response.json()["groups"]


@pytest_asyncio.fixture
async def api() -> _ApiCtx:
    """httpx-клиент поверх приложения с тестовой БД (таблицы очищаются)."""
    from httpx import ASGITransport, AsyncClient

    from main import app

    engine = create_async_engine(os.environ["TEST_DATABASE_URL"])
    async with engine.begin() as conn:
        names = (
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
        if names:
            quoted = ", ".join(f'"public"."{name}"' for name in names)
            await conn.execute(text(f"TRUNCATE TABLE {quoted} CASCADE"))

    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _override_session():
        async with factory() as session:
            yield session

    from core.models import db_helper

    app.dependency_overrides[db_helper.session_dependency] = _override_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield _ApiCtx(client, factory)
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.asyncio
async def test_publish_and_feed(api: _ApiCtx) -> None:
    """Автор видит свою историю, другой пользователь — непросмотренной."""
    author = await api.make_user()
    viewer = await api.make_user()

    response = await api.publish(await api.token_for(author), caption="Привет")
    assert response.status_code == 201, response.text
    story = response.json()
    assert story["caption"] == "Привет"
    assert story["media_url"].startswith("/media/")
    assert story["viewed"] is False

    own_feed = await api.feed(await api.token_for(author))
    assert len(own_feed) == 1
    assert own_feed[0]["is_mine"] is True
    # Своя история не считается «непросмотренной» — точки для себя не рисуем.
    assert own_feed[0]["has_unseen"] is False
    assert own_feed[0]["items"][0]["views"] == 0

    other_feed = await api.feed(await api.token_for(viewer))
    assert len(other_feed) == 1
    assert other_feed[0]["is_mine"] is False
    assert other_feed[0]["has_unseen"] is True
    assert other_feed[0]["items"][0]["viewed"] is False


@pytest.mark.asyncio
async def test_view_marks_seen_and_counts(api: _ApiCtx) -> None:
    """Просмотр убирает «есть новое» у зрителя и увеличивает счётчик у автора."""
    author = await api.make_user()
    viewer = await api.make_user()
    story = (await api.publish(await api.token_for(author))).json()

    viewer_token = await api.token_for(viewer)
    viewed = await api.client.post(
        f"/api/v1/stories/{story['id']}/view/", headers=api.auth(viewer_token)
    )
    assert viewed.status_code == 200, viewed.text
    group = viewed.json()
    assert group["has_unseen"] is False
    assert group["items"][0]["viewed"] is True

    # Повторный просмотр не ломается и не дублирует запись.
    again = await api.client.post(
        f"/api/v1/stories/{story['id']}/view/", headers=api.auth(viewer_token)
    )
    assert again.status_code == 200

    author_feed = await api.feed(await api.token_for(author))
    assert author_feed[0]["items"][0]["views"] == 1

    async with api.factory() as session:
        total = await session.scalar(
            text("SELECT count(*) FROM story_views WHERE story_id = :id").bindparams(
                id=story["id"]
            )
        )
    assert total == 1


@pytest.mark.asyncio
async def test_expired_story_not_shown(api: _ApiCtx) -> None:
    """Просроченная история не попадает в ленту (срок — условие выборки)."""
    author = await api.make_user()
    viewer = await api.make_user()
    await api.publish(await api.token_for(author))

    async with api.factory() as session:
        story = (await session.execute(text("SELECT id FROM stories"))).scalar_one()
        await session.execute(
            text("UPDATE stories SET expires_at = :past WHERE id = :id").bindparams(
                past=datetime.now(timezone.utc) - timedelta(minutes=1), id=story
            )
        )
        await session.commit()

    assert await api.feed(await api.token_for(viewer)) == []
    assert await api.feed(await api.token_for(author)) == []


@pytest.mark.asyncio
async def test_delete_only_own_story(api: _ApiCtx) -> None:
    """Удалить историю может только автор."""
    author = await api.make_user()
    other = await api.make_user()
    story = (await api.publish(await api.token_for(author))).json()

    alien = await api.client.delete(
        f"/api/v1/stories/{story['id']}/", headers=api.auth(await api.token_for(other))
    )
    assert alien.status_code == 404

    own = await api.client.delete(
        f"/api/v1/stories/{story['id']}/", headers=api.auth(await api.token_for(author))
    )
    assert own.status_code == 204
    assert await api.feed(await api.token_for(author)) == []


@pytest.mark.asyncio
async def test_blocked_user_stories_hidden(api: _ApiCtx) -> None:
    """Истории заблокированного пользователя в ленте не показываем."""
    author = await api.make_user()
    viewer = await api.make_user()
    await api.publish(await api.token_for(author))

    async with api.factory() as session:
        session.add(UserBlock(blocker_id=viewer.id, blocked_id=author.id))
        await session.commit()

    assert await api.feed(await api.token_for(viewer)) == []
    # Автор свою историю видит по-прежнему.
    assert len(await api.feed(await api.token_for(author))) == 1


@pytest.mark.asyncio
async def test_upload_validation_and_quota(api: _ApiCtx) -> None:
    """Чужой тип файла не принимаем, а медиа истории попадает в квоту."""
    author = await api.make_user()
    token = await api.token_for(author)

    bad = await api.client.post(
        "/api/v1/stories/",
        params={"filename": "note.txt", "mime": "text/plain"},
        content=b"not a story",
        headers=api.auth(token),
    )
    assert bad.status_code in (400, 415)

    assert (await api.publish(token)).status_code == 201

    from core.media_quota import media_usage

    async with api.factory() as session:
        usage = await media_usage(session, user_id=author.id)
        assert usage.files == 1
        assert usage.used_bytes == len(PNG_BYTES)


@pytest.mark.asyncio
async def test_cleanup_removes_expired(api: _ApiCtx) -> None:
    """Задача уборки удаляет только просроченные истории (и их просмотры)."""
    from api_v1.stories import crud

    author = await api.make_user()
    story = (await api.publish(await api.token_for(author))).json()

    async with api.factory() as session:
        session.add(StoryView(story_id=story["id"], viewer_id=author.id))
        await session.commit()

    async with api.factory() as session:
        # Свежая история не удаляется.
        assert await crud.delete_expired(session) == 0
        await session.commit()

    async with api.factory() as session:
        await session.execute(
            text("UPDATE stories SET expires_at = :past").bindparams(
                past=datetime.now(timezone.utc) - timedelta(hours=1)
            )
        )
        await session.commit()

    async with api.factory() as session:
        assert await crud.delete_expired(session) == 1
        await session.commit()
        assert await session.scalar(text("SELECT count(*) FROM stories")) == 0
        assert await session.scalar(text("SELECT count(*) FROM story_views")) == 0


@pytest.mark.asyncio
async def test_react_toggles_and_counts(api: _ApiCtx) -> None:
    """Реакция ставится, а повторный вызов тем же эмодзи её снимает."""
    author = await api.make_user()
    viewer = await api.make_user()
    story = (await api.publish(await api.token_for(author))).json()
    viewer_token = await api.token_for(viewer)

    first = await api.client.post(
        f"/api/v1/stories/{story['id']}/react/",
        json={"emoji": "🔥"},
        headers=api.auth(viewer_token),
    )
    assert first.status_code == 200, first.text
    reactions = first.json()["reactions"]
    assert reactions == [{"emoji": "🔥", "count": 1, "mine": True}]

    # Второй тап тем же эмодзи снимает реакцию и не оставляет мусора.
    second = await api.client.post(
        f"/api/v1/stories/{story['id']}/react/",
        json={"emoji": "🔥"},
        headers=api.auth(viewer_token),
    )
    assert second.status_code == 200, second.text
    assert second.json()["reactions"] == []

    async with api.factory() as session:
        total = await session.scalar(text("SELECT count(*) FROM story_reactions"))
    assert total == 0


@pytest.mark.asyncio
async def test_reaction_notifies_author(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """О поставленной реакции автор узнаёт: событие в сокет и задача push.

    Снятие реакции автора не касается: панель эмодзи тапают часто, и
    уведомление на каждый тап превратилось бы в спам.
    """
    from api_v1.stories import notify as stories_notify

    author = await api.make_user()
    viewer = await api.make_user()
    story = (await api.publish(await api.token_for(author))).json()
    viewer_token = await api.token_for(viewer)

    events: list[tuple[int, dict]] = []
    tasks: list[tuple[str, tuple]] = []

    class _Events:
        async def send_to_user(self, user_id: int, payload: dict) -> bool:
            events.append((user_id, payload))
            return True

    class _Task:
        def __init__(self, name: str) -> None:
            self.name = name

        def delay(self, *args: object) -> None:
            tasks.append((self.name, args))

    monkeypatch.setattr(stories_notify, "events_manager", _Events())
    monkeypatch.setattr(stories_notify, "get_task", _Task)

    response = await api.client.post(
        f"/api/v1/stories/{story['id']}/react/",
        json={"emoji": "❤️"},
        headers=api.auth(viewer_token),
    )
    assert response.status_code == 200, response.text

    assert [user_id for user_id, _payload in events] == [author.id]
    payload = events[0][1]
    assert payload["type"] == "story.reaction"
    assert payload["story_id"] == story["id"]
    assert payload["emoji"] == "❤️"
    assert payload["user_id"] == viewer.id
    # Имя нужно подсказке в приложении: своей панели его взять негде.
    assert payload["name"]

    assert tasks == [
        (stories_notify.REACTION_PUSH_TASK, (author.id, viewer.id, "❤️", story["id"]))
    ]

    # Повторный тап тем же эмодзи снимает реакцию — и никаких уведомлений.
    again = await api.client.post(
        f"/api/v1/stories/{story['id']}/react/",
        json={"emoji": "❤️"},
        headers=api.auth(viewer_token),
    )
    assert again.status_code == 200, again.text
    assert len(events) == 1
    assert len(tasks) == 1


@pytest.mark.asyncio
async def test_story_reaction_push_names_reactor(
    api: _ApiCtx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Push о реакции: заголовок — имя того, кто отреагировал, тело — эмодзи."""
    from tasks import notifications

    author = await api.make_user()
    reactor = await api.make_user()
    story = (await api.publish(await api.token_for(author))).json()

    async with api.factory() as session:
        row = await session.get(User, reactor.id)
        assert row is not None
        row.first_name = "Иван"
        await session.commit()

    sent: list[tuple[list[int], dict]] = []

    async def _fake_rustore(
        session: object, user_ids: list[int], message: dict
    ) -> None:
        sent.append((user_ids, message))

    class _Engine:
        async def dispose(self) -> None:
            return None

    monkeypatch.setattr(notifications, "_send_rustore_push", _fake_rustore)
    monkeypatch.setattr(notifications, "_web_push_configured", lambda: False)
    monkeypatch.setattr(notifications, "make_engine", _Engine)
    monkeypatch.setattr(notifications, "make_session", lambda engine: api.factory())

    await notifications._send_story_reaction_push_async(
        author.id, reactor.id, "🔥", story["id"]
    )

    assert len(sent) == 1
    user_ids, message = sent[0]
    assert user_ids == [author.id]
    assert message["notification"]["title"] == "Иван"
    assert message["notification"]["body"] == "🔥 Реакция на вашу историю"
    assert message["data"]["type"] == "story_reaction"
    assert message["data"]["story_id"] == str(story["id"])

    # Ночь у автора: push не будим, счётчик реакции дождётся утра.
    sent.clear()
    async with api.factory() as session:
        session.add(
            Profile(
                user_id=author.id,
                quiet_hours_enabled=True,
                quiet_hours_start=23 * 60,
                quiet_hours_end=8 * 60,
                quiet_hours_offset=0,
            )
        )
        await session.commit()
    monkeypatch.setattr(
        notifications,
        "utc_now",
        lambda: datetime(2026, 9, 17, 2, 0, tzinfo=timezone.utc),
    )
    await notifications._send_story_reaction_push_async(
        author.id, reactor.id, "🔥", story["id"]
    )
    assert sent == []


@pytest.mark.asyncio
async def test_react_aggregates_for_author(api: _ApiCtx) -> None:
    """Автор видит счётчики реакций, а `mine` — только у собственной реакции."""
    author = await api.make_user()
    first = await api.make_user()
    second = await api.make_user()
    story = (await api.publish(await api.token_for(author))).json()

    for user, emoji in ((first, "❤️"), (second, "❤️"), (first, "😂")):
        response = await api.client.post(
            f"/api/v1/stories/{story['id']}/react/",
            json={"emoji": emoji},
            headers=api.auth(await api.token_for(user)),
        )
        assert response.status_code == 200, response.text

    author_feed = await api.feed(await api.token_for(author))
    reactions = author_feed[0]["items"][0]["reactions"]
    # Сначала популярные эмодзи, внутри одинаковых счётчиков — порядок набора.
    assert reactions == [
        {"emoji": "❤️", "count": 2, "mine": False},
        {"emoji": "😂", "count": 1, "mine": False},
    ]

    first_feed = await api.feed(await api.token_for(first))
    mine = {
        item["emoji"]: item["mine"] for item in first_feed[0]["items"][0]["reactions"]
    }
    assert mine == {"❤️": True, "😂": True}


@pytest.mark.asyncio
async def test_react_rules(api: _ApiCtx) -> None:
    """Чужая история обязательна: мусор, свои истории и несуществующие — отказ."""
    author = await api.make_user()
    viewer = await api.make_user()
    story = (await api.publish(await api.token_for(author))).json()
    viewer_token = await api.token_for(viewer)

    # Реакции вне набора отклоняем — в БД не должно попасть произвольной строки.
    alien = await api.client.post(
        f"/api/v1/stories/{story['id']}/react/",
        json={"emoji": "🦄"},
        headers=api.auth(viewer_token),
    )
    assert alien.status_code == 400

    # На свою историю реагировать нельзя.
    own = await api.client.post(
        f"/api/v1/stories/{story['id']}/react/",
        json={"emoji": "🔥"},
        headers=api.auth(await api.token_for(author)),
    )
    assert own.status_code == 400

    # Несуществующая история — 404.
    missing = await api.client.post(
        "/api/v1/stories/999999/react/",
        json={"emoji": "🔥"},
        headers=api.auth(viewer_token),
    )
    assert missing.status_code == 404

    async with api.factory() as session:
        total = await session.scalar(text("SELECT count(*) FROM story_reactions"))
    assert total == 0


@pytest.mark.asyncio
async def test_feed_returns_reaction_kinds(api: _ApiCtx) -> None:
    """Набор эмодзи отдаёт сервер — клиент рисует панель по его данным."""
    viewer = await api.make_user()
    response = await api.client.get(
        "/api/v1/stories/", headers=api.auth(await api.token_for(viewer))
    )
    assert response.status_code == 200, response.text
    payload = response.json()

    from api_v1.stories.reactions import STORY_REACTION_KINDS, STORY_REACTIONS_PRIMARY

    assert payload["reaction_kinds"] == list(STORY_REACTION_KINDS)
    assert payload["reactions_primary"] == STORY_REACTIONS_PRIMARY
    assert len(payload["reaction_kinds"]) > payload["reactions_primary"]


@pytest.mark.asyncio
async def test_reactions_removed_with_story(api: _ApiCtx) -> None:
    """Реакции уходят вместе с историей (CASCADE), а не остаются сиротами."""
    author = await api.make_user()
    viewer = await api.make_user()
    story = (await api.publish(await api.token_for(author))).json()

    reacted = await api.client.post(
        f"/api/v1/stories/{story['id']}/react/",
        json={"emoji": "👍"},
        headers=api.auth(await api.token_for(viewer)),
    )
    assert reacted.status_code == 200, reacted.text

    removed = await api.client.delete(
        f"/api/v1/stories/{story['id']}/", headers=api.auth(await api.token_for(author))
    )
    assert removed.status_code == 204

    async with api.factory() as session:
        assert await session.scalar(text("SELECT count(*) FROM story_reactions")) == 0


@pytest.mark.asyncio
async def test_audience_lists_viewers_and_reactions(api: _ApiCtx) -> None:
    """Автор видит, кто смотрел и кто как отреагировал."""
    author = await api.make_user()
    viewer = await api.make_user()
    story = (await api.publish(await api.token_for(author))).json()
    viewer_token = await api.token_for(viewer)

    await api.client.post(
        f"/api/v1/stories/{story['id']}/view/", headers=api.auth(viewer_token)
    )
    await api.client.post(
        f"/api/v1/stories/{story['id']}/react/",
        json={"emoji": "🔥"},
        headers=api.auth(viewer_token),
    )

    response = await api.client.get(
        f"/api/v1/stories/{story['id']}/audience/",
        headers=api.auth(await api.token_for(author)),
    )
    assert response.status_code == 200, response.text
    payload = response.json()

    assert payload["views_total"] == 1
    assert [user["username"] for user in payload["views"]] == [viewer.username]
    [group] = payload["reactions"]
    assert group["emoji"] == "🔥"
    assert [user["username"] for user in group["users"]] == [viewer.username]


@pytest.mark.asyncio
async def test_audience_private_to_author(api: _ApiCtx) -> None:
    """Чужую аудиторию смотреть нельзя: список зрителей — персональные данные."""
    author = await api.make_user()
    viewer = await api.make_user()
    story = (await api.publish(await api.token_for(author))).json()

    alien = await api.client.get(
        f"/api/v1/stories/{story['id']}/audience/",
        headers=api.auth(await api.token_for(viewer)),
    )
    assert alien.status_code == 403

    missing = await api.client.get(
        "/api/v1/stories/999999/audience/",
        headers=api.auth(await api.token_for(author)),
    )
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_audience_counts_group_several_reactors(api: _ApiCtx) -> None:
    """Один эмодзи от разных людей — одна группа со всеми именами."""
    author = await api.make_user()
    first = await api.make_user()
    second = await api.make_user()
    story = (await api.publish(await api.token_for(author))).json()

    for user in (first, second):
        await api.client.post(
            f"/api/v1/stories/{story['id']}/react/",
            json={"emoji": "❤️"},
            headers=api.auth(await api.token_for(user)),
        )

    response = await api.client.get(
        f"/api/v1/stories/{story['id']}/audience/",
        headers=api.auth(await api.token_for(author)),
    )
    assert response.status_code == 200, response.text
    [group] = response.json()["reactions"]
    assert group["emoji"] == "❤️"
    assert {user["username"] for user in group["users"]} == {
        first.username,
        second.username,
    }


@pytest.mark.asyncio
async def test_stories_rate_limits(api: _ApiCtx) -> None:
    """Реакции и просмотры ограничены по частоте (как остальные эндпоинты)."""
    from core.config import settings
    from core.rate_limit import rate_limiter

    author = await api.make_user()
    viewer = await api.make_user()
    story = (await api.publish(await api.token_for(author))).json()
    viewer_token = await api.token_for(viewer)

    # Лимит реакций: исчерпываем окно и проверяем, что дальше приходит 429.
    rate_limiter.reset()
    for _ in range(settings.story_react_limit_per_minute):
        response = await api.client.post(
            f"/api/v1/stories/{story['id']}/react/",
            json={"emoji": "🔥"},
            headers=api.auth(viewer_token),
        )
        assert response.status_code == 200, response.text

    blocked = await api.client.post(
        f"/api/v1/stories/{story['id']}/react/",
        json={"emoji": "🔥"},
        headers=api.auth(viewer_token),
    )
    assert blocked.status_code == 429

    # Лимит просмотров — отдельный счётчик, реакция его не исчерпала.
    rate_limiter.reset()
    for _ in range(settings.story_view_limit_per_minute):
        response = await api.client.post(
            f"/api/v1/stories/{story['id']}/view/", headers=api.auth(viewer_token)
        )
        assert response.status_code == 200, response.text

    blocked_view = await api.client.post(
        f"/api/v1/stories/{story['id']}/view/", headers=api.auth(viewer_token)
    )
    assert blocked_view.status_code == 429
    rate_limiter.reset()
