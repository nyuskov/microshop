"""Имена файлов media, на которые ссылаются записи БД.

Зачем отдельный модуль: этот список нужен сразу двум местам — периодической
задаче воркера (``tasks/media_tasks.cleanup_orphan_media``) и ручному скрипту
(``scripts/cleanup_orphan_media.py``). Пока списки жили порознь, они разошлись, и
ночная очистка удаляла ЖИВЫЕ файлы как «сироты»: стикеры из библиотеки
(``stickers.file_url``) пропали с прода, а вместе с ними — картинки публичных
наборов, которые видит каждый.

Правило на будущее: новая таблица, которая хранит путь в ``/media/...``, обязана
попасть СЮДА. Оба вызывающих места берут набор отсюда, поэтому «поправил одно,
забыл другое» больше не повторится.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.avatar_store import push_icon_stored_name
from core.models import Chat, LinkPreview, Message, Sticker, Story, User

#: Всё, что ссылается на файл в media. Имя таблицы → колонки с URL.
#: Снимки (пересылка, ответ на историю) тоже здесь: пока строка ссылается на файл,
#: очистка не вправе считать его «сиротой» — иначе плашка «Переслано от …» или
#: «Ответ на историю» теряет картинку.
MEDIA_URL_COLUMNS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "messages",
        ("file_url", "forwarded_sender_avatar_url", "reply_to_story_media_url"),
    ),
    ("stickers", ("file_url",)),
    ("user", ("avatar_url", "avatar_thumb_url")),
    ("chats", ("avatar_url", "avatar_thumb_url")),
    ("stories", ("media_url",)),
    ("link_previews", ("image_url",)),
)


def names_from_urls(urls: list[str | None] | tuple[str | None, ...] | None) -> set[str]:
    """Из ``/media/...`` URL достаёт имена файлов (пути и мусор отбрасываем)."""
    names: set[str] = set()
    for url in urls or ():
        if not url or not url.startswith("/media/"):
            continue
        names.add(Path(url).name)
    return names


async def collect_used_media_names(session: AsyncSession) -> set[str]:
    """Имена файлов, на которые ссылаются записи БД.

    Проверяем сообщения (вложение и снимки: пересылка, ответ на историю),
    стикеры (библиотека, а не сообщения!), аватары людей и групп вместе с
    миниатюрами, медиа историй и картинки превью ссылок.

    ГРАБЛЯ: у результата выборки ``.all()`` зовём РОВНО ОДИН РАЗ на запрос.
    Курсор небуферизованный: второй вызов возвращает пустой список, и часть
    колонок молча теряется (так миниатюры аватаров не попали в список и были
    удалены ночной очисткой).
    """
    used: set[str] = set()

    message_rows = (
        await session.execute(
            select(
                Message.file_url,
                Message.forwarded_sender_avatar_url,
                Message.reply_to_story_media_url,
            ).where(
                Message.file_url.is_not(None)
                | Message.forwarded_sender_avatar_url.is_not(None)
                | Message.reply_to_story_media_url.is_not(None)
            )
        )
    ).all()
    used |= names_from_urls([row[0] for row in message_rows])
    used |= names_from_urls([row[1] for row in message_rows])
    used |= names_from_urls([row[2] for row in message_rows])

    # Стикеры живут отдельно от сообщений: без этой выборки очистка удаляет файлы
    # библиотеки как «сироты» (публичные наборы после этого показываются пустыми).
    sticker_rows = (
        await session.execute(
            select(Sticker.file_url).where(Sticker.file_url.is_not(None))
        )
    ).all()
    used |= names_from_urls([row[0] for row in sticker_rows])

    # Аватары: оригинал и миниатюра. Миниатюру клиент предпочитает оригиналу,
    # поэтому её потеря видна как «аватарки пропали».
    user_rows = (
        await session.execute(
            select(User.avatar_url, User.avatar_thumb_url).where(
                User.avatar_url.is_not(None)
            )
        )
    ).all()
    user_avatars = names_from_urls([row[0] for row in user_rows])
    user_avatars |= names_from_urls([row[1] for row in user_rows])
    used |= user_avatars
    # Иконки уведомлений лежат рядом с аватарами и выводятся из их имён
    # (`user_5_ab_n192.png`), в БД их адреса нет: без этой строки очистка удаляла
    # бы их как «сироты», и генерация повторялась бы при каждом push.
    used |= {push_icon_stored_name(name) for name in user_avatars}

    # Аватары групп — в том же каталоге, что и пользовательские.
    chat_rows = (
        await session.execute(
            select(Chat.avatar_url, Chat.avatar_thumb_url).where(
                Chat.avatar_url.is_not(None)
            )
        )
    ).all()
    chat_avatars = names_from_urls([row[0] for row in chat_rows])
    chat_avatars |= names_from_urls([row[1] for row in chat_rows])
    used |= chat_avatars
    used |= {push_icon_stored_name(name) for name in chat_avatars}

    # Медиа историй: файл живёт, пока есть запись (история — максимум сутки).
    story_rows = (
        await session.execute(
            select(Story.media_url).where(Story.media_url.is_not(None))
        )
    ).all()
    used |= names_from_urls([row[0] for row in story_rows])

    # Картинки превью внешних ссылок: скачаны нами в media, адрес — в БД.
    preview_rows = (
        await session.execute(
            select(LinkPreview.image_url).where(LinkPreview.image_url.is_not(None))
        )
    ).all()
    used |= names_from_urls([row[0] for row in preview_rows])

    return used


__all__ = ("MEDIA_URL_COLUMNS", "collect_used_media_names", "names_from_urls")
