"""Очистка файлов media не должна трогать файлы живых записей.

Поводом стал прод: ночная задача ``cleanup_orphan_media`` собирала «используемые»
имена своей копией выборок, в которой не было ни стикеров (таблица ``stickers``),
ни картинок превью ссылок, ни иконок уведомлений. Файлы публичных наборов
удалялись как «сироты» — и человек, тапнув по стикеру, видел пустое окно.

Здесь проверяем именно состав списка: он лежит в одном месте
(``core.media_usage``) и обязан покрывать все таблицы, которые хранят путь в
``/media/...``. Тест «дрейфа» ниже падает, если в модели добавили такую колонку,
а в список её не внесли.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from core import media_usage
from core.models import Chat, LinkPreview, Message, Sticker, StickerPack, Story, User
from scripts import make_avatar_thumbs

needs_db = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL)",
)

#: Колонки с URL, которые ведут НЕ в медиа нашего сервера: это адрес чужой
#: страницы (кэш карточек ссылок), файла в ``backend/media`` у него нет.
EXTERNAL_URL_COLUMNS = {("link_previews", "url")}

#: Каталог с исходниками (тесты запускаются из ``backend/``, но лучше не зависеть).
BACKEND_DIR = Path(__file__).resolve().parent.parent


def _media_columns_in_models() -> set[tuple[str, str]]:
    """Все колонки моделей, чьё имя похоже на путь/адрес файла."""
    found: set[tuple[str, str]] = set()
    models = (Chat, LinkPreview, Message, Sticker, StickerPack, Story, User)
    for model in models:
        table = model.__tablename__
        for column in model.__table__.columns:
            name = column.key
            if "url" not in name and "avatar" not in name:
                continue
            found.add((table, name))
    return found


def test_media_usage_covers_every_media_column() -> None:
    """Новая колонка с путём в media обязана попасть в общий список.

    Без этого теста очистка снова начнёт удалять живые файлы: список «сирот»
    строится как «файл, имени которого нет среди используемых».
    """
    declared = {
        (table, column)
        for table, columns in media_usage.MEDIA_URL_COLUMNS
        for column in columns
    }
    unknown = _media_columns_in_models() - declared - EXTERNAL_URL_COLUMNS

    assert unknown == set(), (
        "Колонки с URL не учтены в core.media_usage.MEDIA_URL_COLUMNS (или не "
        f"добавлены в EXTERNAL_URL_COLUMNS, если это чужой адрес): {sorted(unknown)}"
    )


@needs_db
async def test_collect_used_names_covers_all_rows(session) -> None:
    """Список «используемых» имён собирается по всем таблицам с медиа."""
    author = User(
        username="cleanup_author",
        hashed_password="x",
        is_active=True,
        is_superuser=False,
        is_verified=False,
        avatar_url="/media/avatars/u1_full.jpg",
        avatar_thumb_url="/media/avatars/u1_full_t128.jpg",
    )
    session.add(author)
    await session.flush()

    chat = Chat(
        name="Группа",
        is_group=True,
        avatar_url="/media/avatars/chat_1_group.jpg",
        avatar_thumb_url="/media/avatars/chat_1_group_t128.jpg",
    )
    session.add(chat)
    await session.flush()

    session.add(
        Message(
            chat_id=chat.id,
            user_id=author.id,
            text="привет",
            file_url="/media/msg_file.png",
            forwarded_sender_avatar_url="/media/avatars/u9_full.jpg",
            reply_to_story_media_url="/media/story_snap.jpg",
        )
    )
    pack = StickerPack(owner_id=author.id, title="Мои стикеры")
    session.add(pack)
    await session.flush()
    session.add(Sticker(pack_id=pack.id, file_url="/media/sticker_1.webp", position=0))
    session.add(
        Story(
            user_id=author.id,
            media_url="/media/story_1.jpg",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
        )
    )
    session.add(
        LinkPreview(url="https://example.com/a", image_url="/media/preview_1.jpg")
    )
    await session.commit()

    used = await media_usage.collect_used_media_names(session)

    assert {
        "u1_full.jpg",
        "u1_full_t128.jpg",
        "chat_1_group.jpg",
        "chat_1_group_t128.jpg",
        "msg_file.png",
        "u9_full.jpg",
        "story_snap.jpg",
        "sticker_1.webp",
        "story_1.jpg",
        "preview_1.jpg",
    } <= used
    # Иконки уведомлений выводятся из имён аватаров и в БД не хранятся.
    assert "u1_full_n192.png" in used
    assert "chat_1_group_n192.png" in used


def test_cleanup_task_and_script_share_one_collector() -> None:
    """Задача воркера и скрипт берут список из одного модуля.

    Своя копия выборок в задаче — ровно то, из-за чего файлы стикеров пропали с
    прода; повторять её нельзя.
    """
    task_source = (BACKEND_DIR / "tasks" / "media_tasks.py").read_text(encoding="utf-8")
    script_source = (BACKEND_DIR / "scripts" / "cleanup_orphan_media.py").read_text(
        encoding="utf-8"
    )

    for source in (task_source, script_source):
        assert "collect_used_media_names" in source
        assert "_collect_names" not in source


def test_missing_thumb_file_needs_regeneration(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Потерянный файл миниатюры — тоже повод её пересобрать.

    Ссылка в БД есть, а файла нет: клиент показывает битую картинку вместо
    аватара (так было на проде после неудачной очистки). Скрипт обязан видеть
    такой аватар как «без миниатюры», иначе починка не сработает.
    """
    monkeypatch.setattr(make_avatar_thumbs, "AVATAR_DIR", tmp_path)
    row = User(
        username="u",
        hashed_password="x",
        avatar_url="/media/avatars/u1_full.jpg",
        avatar_thumb_url="/media/avatars/u1_full_t128.jpg",
    )

    assert make_avatar_thumbs._thumb_missing(row) is True

    (tmp_path / "u1_full_t128.jpg").write_bytes(b"thumb")

    assert make_avatar_thumbs._thumb_missing(row) is False


def test_avatar_without_thumb_url_needs_regeneration() -> None:
    """Старый аватар (колонка пуста) — обычный случай для скрипта."""
    row = User(username="u", hashed_password="x", avatar_url="/media/avatars/u1.jpg")

    assert make_avatar_thumbs._thumb_missing(row) is True
