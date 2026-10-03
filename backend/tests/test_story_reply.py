"""Ответ на историю текстом: сообщение автору в личный чат.

Ответ на историю — это обычное сообщение в личном чате автора с пометкой
``reply_to_story_id``: в переписке над текстом рисуется плашка «Ответ на
историю» с превью медиа. Проверяем: сообщение уходит и содержит снимок медиа,
своя/истёкшая/чужая история отклоняются, а после удаления истории плашка
остаётся (ссылка обнуляется, снимок живёт).
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from tests.api_support import _ApiCtx  # noqa: E402
from tests.api_support import api as api_fixture  # noqa: E402

api = api_fixture

#: Минимальный валидный PNG (1×1) — медиа истории.
PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    b"\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
    b"\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)

needs_db = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


async def _publish(api: _ApiCtx, token: str) -> dict:
    response = await api.client.post(
        "/api/v1/stories/",
        params={"filename": "story.png", "mime": "image/png", "caption": "из отпуска"},
        content=PNG,
        headers=api.auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _reply(api: _ApiCtx, token: str, chat_id: int, text_body: str, story_id: int):
    return await api.client.post(
        "/api/v1/messages/",
        json={
            "chat_id": chat_id,
            "text": text_body,
            "reply_to_story_id": story_id,
        },
        headers=api.auth(token),
    )


async def _messages(api: _ApiCtx, token: str, chat_id: int) -> list[dict]:
    response = await api.client.get(
        f"/api/v1/messages/{chat_id}/", headers=api.auth(token)
    )
    assert response.status_code == 200, response.text
    return response.json()


@needs_db
async def test_story_reply_creates_message_with_snapshot(api: _ApiCtx) -> None:
    """Ответ уходит в личный чат автора и несёт снимок медиа истории."""
    author = await api.make_user()
    viewer = await api.make_user()
    author_token = await api.token_for(author)
    viewer_token = await api.token_for(viewer)

    story = await _publish(api, author_token)
    chat = await api.private_chat(viewer_token, author.id)

    response = await _reply(api, viewer_token, chat["id"], "Красиво!", story["id"])
    assert response.status_code == 200, response.text
    payload = response.json()

    assert payload["text"] == "Красиво!"
    assert payload["reply_to_story"] == {
        "id": story["id"],
        "media_url": story["media_url"],
        "mime_type": "image/png",
    }

    # Автор видит то же самое: снимок едет с сообщением, а не подгружается из истории.
    for token in (viewer_token, author_token):
        messages = await _messages(api, token, chat["id"])
        assert len(messages) == 1
        assert messages[0]["reply_to_story"]["media_url"] == story["media_url"]


@needs_db
async def test_story_reply_rules(api: _ApiCtx) -> None:
    """Своя история, чужая история и истёкшая — отказ."""
    author = await api.make_user()
    viewer = await api.make_user()
    stranger = await api.make_user()
    author_token = await api.token_for(author)
    viewer_token = await api.token_for(viewer)

    story = await _publish(api, author_token)
    viewer_chat = await api.private_chat(viewer_token, author.id)
    author_chat = await api.private_chat(author_token, viewer.id)
    stranger_chat = await api.private_chat(await api.token_for(stranger), author.id)

    # На свою историю не отвечают.
    own = await _reply(api, author_token, author_chat["id"], "себе", story["id"])
    assert own.status_code == 400
    assert "ваша история" in own.json()["detail"]

    # Несуществующая история.
    missing = await _reply(api, viewer_token, viewer_chat["id"], "в пустоту", 999999)
    assert missing.status_code == 400
    assert "не найдена" in missing.json()["detail"]

    # Ответ в чужой чат: автор истории в нём не состоит.
    alien_chat = await api.private_chat(viewer_token, stranger.id)
    alien = await _reply(api, viewer_token, alien_chat["id"], "мимо", story["id"])
    assert alien.status_code == 400
    assert "автору в личный чат" in alien.json()["detail"]
    # Тот же запрет, когда автор истории писал в чат с третьим пользователем.
    assert stranger_chat["id"] != alien_chat["id"]

    # Истёкшая история: отвечать некуда.
    async with api.factory() as session:
        await session.execute(
            text("UPDATE stories SET expires_at = :ts WHERE id = :id"),
            {
                "ts": datetime.now(timezone.utc) - timedelta(hours=1),
                "id": story["id"],
            },
        )
        await session.commit()
    expired = await _reply(api, viewer_token, viewer_chat["id"], "поздно", story["id"])
    assert expired.status_code == 400
    assert "больше не доступна" in expired.json()["detail"]


@needs_db
async def test_story_reply_survives_story_deletion(api: _ApiCtx) -> None:
    """История удаляется через сутки — плашка остаётся по снимку медиа."""
    author = await api.make_user()
    viewer = await api.make_user()
    author_token = await api.token_for(author)
    viewer_token = await api.token_for(viewer)

    story = await _publish(api, author_token)
    chat = await api.private_chat(viewer_token, author.id)
    assert (
        await _reply(api, viewer_token, chat["id"], "ещё как", story["id"])
    ).status_code == 200

    deleted = await api.client.delete(
        f"/api/v1/stories/{story['id']}/", headers=api.auth(author_token)
    )
    assert deleted.status_code == 204, deleted.text

    messages = await _messages(api, viewer_token, chat["id"])
    reply = messages[0]["reply_to_story"]
    # Ссылка обнулилась (ON DELETE SET NULL), а медиа-снимок остался.
    assert reply["id"] is None
    assert reply["media_url"] == story["media_url"]
    assert reply["mime_type"] == "image/png"
