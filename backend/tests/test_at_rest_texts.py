"""Тесты шифрования «в покое» для всего пользовательского текста.

Проверяем две вещи, каждая из которых ломается тихо:

* **шифруется ли на самом деле** — читаем значение СЫРЫМ SQL, потому что через
  модель оно приходит уже расшифрованным и «всё хорошо» ничего не доказывает;
* **не забыта ли колонка** — список целей скрипта `scripts/encrypt_texts.py`
  сверяется с моделями: если кто-то добавит `EncryptedText` и не добавит цель,
  тест это поймает (иначе история осталась бы открытой, а команда сказала бы
  «готово»).

БД-часть запускается только при заданном `TEST_DATABASE_URL` (фикстура `session`
из `conftest.py`).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy import text as sql_text
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from core import at_rest
from core.config import settings
from core.db_types import EncryptedText
from core.models import (
    Base,
    ChannelComment,
    ChannelSuggestion,
    Chat,
    Contact,
    LinkPreview,
    Message,
    MessageDraft,
    ModerationAction,
    Profile,
    RegistrationInvite,
    Story,
    User,
    UserReport,
)
from scripts import encrypt_texts

KEY_HEX = bytes(range(32)).hex()
SECRET = "секретный пользовательский текст"


@pytest.fixture
def with_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Шифрование включено."""
    monkeypatch.setattr(settings, "at_rest_key", KEY_HEX)


@pytest.fixture
def without_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Шифрование выключено — режим «как было до включения ключа»."""
    monkeypatch.setattr(settings, "at_rest_key", None)


@pytest.fixture
def plain_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ключ выключен ДО создания тестовых данных (как было на проде до включения)."""
    monkeypatch.setattr(settings, "at_rest_key", None)


@pytest_asyncio.fixture
async def world(session: AsyncSession) -> SimpleNamespace:
    """Минимальный мир: владелец, собеседник, чат и сообщение в нём."""
    owner = User(
        username="owner",
        hashed_password="x",
        first_name=SECRET,
        last_name=SECRET,
        status=SECRET,
    )
    peer = User(username="peer", hashed_password="x")
    session.add_all([owner, peer])
    await session.commit()
    await session.refresh(owner)
    await session.refresh(peer)

    chat = Chat(name="чат проверки")
    session.add(chat)
    await session.commit()
    await session.refresh(chat)

    message = Message(chat_id=chat.id, user_id=owner.id, text=SECRET)
    session.add(message)
    await session.commit()
    await session.refresh(message)

    return SimpleNamespace(owner=owner, peer=peer, chat=chat, message=message)


async def _ensure_row(
    session: AsyncSession, target, world: SimpleNamespace
) -> None:  # noqa: ANN001
    """Создаёт строку, которую проверяет тест (у части целей она уже есть).

    Значение пишем именно здесь, а не только в фикстуре: иначе оно уходило бы в
    БД в тот момент, когда ключ ещё не выставлен тестом, и проверка «зашифровано
    ли» смотрела бы не на то состояние.
    """
    now = datetime.now(timezone.utc)
    name = target.name
    if name == "messages.text":
        # UPDATE через модель, а не присваивание: если присвоить то же самое
        # значение, SQLAlchemy не заметит изменения и не отправит UPDATE вовсе.
        await session.execute(
            update(Message).where(Message.id == world.message.id).values(text=SECRET)
        )
        await session.commit()
        return
    if name.startswith("user."):
        await session.execute(
            update(User)
            .where(User.id == world.owner.id)
            .values(**{target.column: SECRET})
        )
        await session.commit()
        return
    if name == "message_drafts.text":
        session.add(
            MessageDraft(user_id=world.owner.id, chat_id=world.chat.id, text=SECRET)
        )
    elif name == "channel_comments.text":
        session.add(
            ChannelComment(
                chat_id=world.chat.id,
                message_id=world.message.id,
                user_id=world.owner.id,
                text=SECRET,
            )
        )
    elif name == "channel_suggestions.text":
        session.add(
            ChannelSuggestion(
                chat_id=world.chat.id, author_id=world.owner.id, text=SECRET
            )
        )
    elif name == "stories.caption":
        session.add(
            Story(
                user_id=world.owner.id,
                caption=SECRET,
                media_url="/media/story.png",
                media_size=10,
                created_at=now,
                expires_at=now + timedelta(hours=24),
            )
        )
    elif name == "contacts.custom_name":
        session.add(
            Contact(
                owner_id=world.owner.id,
                contact_user_id=world.peer.id,
                custom_name=SECRET,
            )
        )
    elif name == "user_reports.comment":
        session.add(
            UserReport(
                reporter_id=world.owner.id,
                reported_id=world.peer.id,
                reason="other",
                comment=SECRET,
            )
        )
    elif name == "user_reports.note":
        session.add(
            UserReport(
                reporter_id=world.owner.id,
                reported_id=world.peer.id,
                reason="other",
                note=SECRET,
            )
        )
    elif name == "moderation_actions.note":
        session.add(ModerationAction(action="message_hidden", note=SECRET))
    elif name == "registration_invites.note":
        session.add(RegistrationInvite(token="invite-token", note=SECRET))
    elif name == "profile.bio":
        session.add(Profile(user_id=world.owner.id, bio=SECRET))
    elif name in (
        "link_previews.title",
        "link_previews.description",
        "link_previews.site_name",
    ):
        # Одна карточка на адрес (`url` уникален), а целей у таблицы три:
        # строку переиспользуем, иначе повторная вставка упадёт на уникальности.
        existing = (await session.scalars(select(LinkPreview).limit(1))).first()
        if existing is None:
            session.add(
                LinkPreview(
                    url="https://example.com/article", **{target.column: SECRET}
                )
            )
            await session.commit()
            return
        await session.execute(
            update(LinkPreview)
            .where(LinkPreview.id == existing.id)
            .values(**{target.column: SECRET})
        )
    else:  # pragma: no cover - защита от опечатки в TARGETS
        raise AssertionError(f"Нет построителя строки для {name}")
    await session.commit()


async def _raw_value(session: AsyncSession, target) -> str | None:  # noqa: ANN001
    """Значение колонки сырым SQL — именно так видно, что лежит в БД.

    Через модель значение пришло бы уже расшифрованным (тип `EncryptedText`).
    """
    result = await session.execute(
        sql_text(
            f'SELECT "{target.column}" FROM "{target.table}" '
            f'WHERE "{target.column}" IS NOT NULL LIMIT 1'
        )
    )
    return result.scalar()


async def _orm_value(session: AsyncSession, target):  # noqa: ANN001
    """Значение, которое видит код (после расшифровки)."""
    session.expire_all()
    order_by = [getattr(target.model, name) for name in target.pk]
    column = getattr(target.model, target.column)
    # Берём строку, где колонка заполнена: у одной таблицы бывает несколько
    # целей (в `user_reports` — комментарий и заметка в разных строках).
    stmt = select(target.model).where(column.is_not(None)).order_by(*order_by).limit(1)
    row = (await session.scalars(stmt)).first()
    assert row is not None
    return getattr(row, target.column)


# --- Соответствие целей моделям (без БД) --------------------------------


def test_targets_match_models() -> None:
    """Список целей не разошёлся с моделями: таблица, колонка, первичный ключ."""
    for target in encrypt_texts.TARGETS:
        table = target.model.__table__
        assert table.name == target.table, target.name
        assert target.column in table.columns, target.name
        pk = tuple(column.name for column in table.primary_key.columns)
        assert target.pk == pk, target.name
        assert isinstance(table.columns[target.column].type, EncryptedText), target.name


def test_every_encrypted_column_has_a_target() -> None:
    """Ни одна колонка с `EncryptedText` не забыта в скрипте перешифровки."""
    encrypted = {
        f"{table.name}.{column.name}"
        for table in Base.metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, EncryptedText)
    }
    assert encrypted == {target.name for target in encrypt_texts.TARGETS}


def test_select_targets_by_table_and_column() -> None:
    """`--only` понимает и таблицу, и пару «таблица.колонка»."""
    assert {target.name for target in encrypt_texts.select_targets("user")} == {
        "user.first_name",
        "user.last_name",
        "user.status",
    }
    assert [
        target.name for target in encrypt_texts.select_targets("stories.caption")
    ] == ["stories.caption"]
    assert encrypt_texts.select_targets(None) == encrypt_texts.TARGETS
    with pytest.raises(SystemExit):
        encrypt_texts.select_targets("такой-таблицы-нет")


# --- Запись и чтение через модель --------------------------------------


@pytest.mark.parametrize("target", encrypt_texts.TARGETS, ids=lambda t: t.name)
async def test_new_rows_are_encrypted(
    session: AsyncSession,
    world: SimpleNamespace,
    target,  # noqa: ANN001
    with_key,  # noqa: ANN001 - фикстура
) -> None:
    """Новая запись уходит на диск зашифрованной, а читается как обычный текст."""
    await _ensure_row(session, target, world)

    raw = await _raw_value(session, target)
    assert raw is not None
    assert raw.startswith(at_rest.PREFIX)
    assert SECRET not in raw
    assert await _orm_value(session, target) == SECRET


@pytest.mark.parametrize("target", encrypt_texts.TARGETS, ids=lambda t: t.name)
async def test_without_key_rows_stay_readable(
    session: AsyncSession,
    world: SimpleNamespace,
    target,  # noqa: ANN001
    without_key,  # noqa: ANN001 - фикстура
) -> None:
    """Без ключа всё работает как раньше: в БД открытый текст, читается он же."""
    await _ensure_row(session, target, world)

    assert await _raw_value(session, target) == SECRET
    assert await _orm_value(session, target) == SECRET


# --- Перешифровка истории -----------------------------------------------


async def test_backfill_encrypts_legacy_rows_for_every_target(
    plain_env,  # noqa: ANN001 - ключ выключен ещё до создания данных
    session: AsyncSession,
    world: SimpleNamespace,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """История (открытый текст) закрывается скриптом — и повторный прогон пуст."""
    for target in encrypt_texts.TARGETS:
        await _ensure_row(session, target, world)
        assert await _raw_value(session, target) == SECRET

    monkeypatch.setattr(settings, "at_rest_key", KEY_HEX)
    for target in encrypt_texts.TARGETS:
        assert await encrypt_texts.count_pending(session, target) >= 1, target.name

    for target in encrypt_texts.TARGETS:
        assert await encrypt_texts.encrypt_batch(session, target, 100) >= 1, target.name

    for target in encrypt_texts.TARGETS:
        raw = await _raw_value(session, target)
        assert raw is not None and raw.startswith(at_rest.PREFIX), target.name
        # Идемпотентность: второй прогон не находит работы и не портит данные.
        assert await encrypt_texts.count_pending(session, target) == 0, target.name
        assert await _orm_value(session, target) == SECRET, target.name


async def test_backfill_does_not_touch_empty_values(
    session: AsyncSession, world: SimpleNamespace, with_key  # noqa: ANN001
) -> None:
    """Пустые строки и NULL не считаются работой (иначе вечный «остаток»)."""
    session.add(ModerationAction(action="message_hidden", note=""))
    await session.commit()

    target = next(
        item for item in encrypt_texts.TARGETS if item.name == "moderation_actions.note"
    )
    assert await encrypt_texts.count_pending(session, target) == 0
