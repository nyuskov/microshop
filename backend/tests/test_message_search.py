"""БД-тесты серверного поиска сообщений (нужен TEST_DATABASE_URL)."""

import pytest
from fastapi import HTTPException

from api_v1.messages.crud import search_messages
from core.models import Chat, Message, User


async def _make_user(session, username: str) -> User:
    user = User(
        username=username,
        phone_number=None,
        hashed_password="x",
        is_active=True,
        is_superuser=False,
        is_verified=False,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def test_search_scoped_to_chat_and_membership(session) -> None:
    u1 = await _make_user(session, "search_u1")
    u2 = await _make_user(session, "search_u2")
    outsider = await _make_user(session, "search_outsider")

    chat = Chat(name="chat")
    chat.users = [u1, u2]
    session.add(chat)
    await session.commit()
    await session.refresh(chat)

    session.add_all(
        [
            Message(chat_id=chat.id, user_id=u1.id, text="needle alpha"),
            Message(chat_id=chat.id, user_id=u2.id, text="ordinary beta"),
        ]
    )
    await session.commit()

    # Поиск внутри чата находит только совпадение.
    found = await search_messages(
        session, user_id=u1.id, query="needle", chat_id=chat.id
    )
    assert len(found) == 1
    assert found[0]["text"] == "needle alpha"

    # Поиск по всем чатам пользователя тоже работает.
    all_found = await search_messages(session, user_id=u1.id, query="needle")
    assert len(all_found) == 1

    # Не-участник получает 403.
    with pytest.raises(HTTPException) as exc:
        await search_messages(
            session,
            user_id=outsider.id,
            query="needle",
            chat_id=chat.id,
        )
    assert exc.value.status_code == 403
