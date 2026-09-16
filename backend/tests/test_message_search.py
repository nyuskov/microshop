"""БД-тесты серверного поиска сообщений (нужен TEST_DATABASE_URL).

С появлением шифрования «в покое» тексты лежат зашифрованными, поэтому поиск
идёт в приложении (SQL по такому полю ничего не найдёт). Тесты следят за тем,
что прежнее поведение сохранилось: подстрока без учёта регистра, поиск внутри
чата и по всем чатам, 403 не-участнику — и всё это на зашифрованных данных.
"""

import base64

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from api_v1.messages.crud import search_messages
from core import at_rest
from core.config import settings
from core.models import Chat, Message, User

#: Ключ для тестов «с шифрованием» (в бою приходит из AT_REST_KEY).
AT_REST_KEY = base64.b64encode(bytes(range(32))).decode()


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


async def test_search_finds_encrypted_text(
    session, monkeypatch
) -> None:  # noqa: ANN001
    """Поиск работает, когда тексты зашифрованы, и в базе их не видно.

    Это главная проверка фичи: шифрование не должно «убить» поиск по сообщениям.
    """
    monkeypatch.setattr(settings, "at_rest_key", AT_REST_KEY)
    u1 = await _make_user(session, "enc_u1")
    u2 = await _make_user(session, "enc_u2")
    chat = Chat(name="enc-chat")
    chat.users = [u1, u2]
    session.add(chat)
    await session.commit()
    await session.refresh(chat)

    session.add_all(
        [
            Message(chat_id=chat.id, user_id=u1.id, text="Секретное слово"),
            Message(chat_id=chat.id, user_id=u2.id, text="Обычное сообщение"),
        ]
    )
    await session.commit()

    # В базе лежит шифротекст: открытого текста в сырой колонке нет.
    # Читаем именно сырым SQL — через модель значение уже расшифровано типом.
    raw = await session.execute(text("SELECT text FROM messages"))
    values = [value for (value,) in raw.all()]
    assert values, "сообщения должны были записаться"
    assert all(at_rest.is_encrypted(value) for value in values)
    assert not any("Секретное слово" in (value or "") for value in values)

    # А поиск по подстроке (в любом регистре) находит зашифрованное.
    found = await search_messages(
        session, user_id=u1.id, query="секрет", chat_id=chat.id
    )
    assert [item["text"] for item in found] == ["Секретное слово"]
    # Тот же запрос без совпадений — пусто (фильтр не «пропускает всё»).
    assert await search_messages(session, user_id=u1.id, query="нет-такого") == []
