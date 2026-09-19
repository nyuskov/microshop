"""Удаляет файлы-«сироты» в media (на которые нет ссылок в БД).

Файлы сообщений (messages.file_url), стикеры (stickers.file_url), аватары
(user.avatar_url), медиа историй (stories.media_url) и картинки превью ссылок
(link_previews.image_url), оставшиеся на диске после удаления записей или сбоев,
копятся бесконечно. Скрипт находит файлы в backend/media, на которые нет ссылок
в БД, и (по флагу) удаляет их.

Запуск (нужен доступ к БД, например внутри контейнера web):
    poetry run python -m scripts.cleanup_orphan_media           # dry-run, только список
    poetry run python -m scripts.cleanup_orphan_media --delete  # реальное удаление

Для cron добавьте строку (в контейнере/хосте с доступом к БД):
    0 4 * * * cd /path && poetry run python -m scripts.cleanup_orphan_media --delete
"""

import argparse
import asyncio
from pathlib import Path

from sqlalchemy import select

from core.avatar_store import push_icon_stored_name
from core.models import Chat, LinkPreview, Message, Sticker, Story, User, db_helper

MEDIA_DIR = Path(__file__).resolve().parent.parent / "media"


def _collect_names(urls: list[str | None]) -> set[str]:
    """Из /media/... URL достаёт имена файлов."""
    names: set[str] = set()
    for url in urls or []:
        if not url or not url.startswith("/media/"):
            continue
        names.add(Path(url).name)
    return names


async def _collect_used(session) -> set[str]:
    """Имена файлов, на которые ссылаются записи БД.

    Проверяем сообщения, стикеры, аватары (людей и групп), истории и превью
    ссылок — всё, что хранит путь в ``media``.
    """
    used: set[str] = set()

    result = await session.execute(
        select(Message.file_url).where(Message.file_url.is_not(None))
    )
    used |= _collect_names([row[0] for row in result.all()])

    # Стикеры живут отдельно от сообщений: без этой строки скрипт удалял бы
    # файлы живых стикеров как «сироты».
    result = await session.execute(
        select(Sticker.file_url).where(Sticker.file_url.is_not(None))
    )
    used |= _collect_names([row[0] for row in result.all()])

    result = await session.execute(
        select(User.avatar_url, User.avatar_thumb_url).where(
            User.avatar_url.is_not(None)
        )
    )
    user_avatar_names = _collect_names([row[0] for row in result.all()])
    user_avatar_names |= _collect_names([row[1] for row in result.all()])
    used |= user_avatar_names
    # Иконки уведомлений лежат рядом с аватарами и выводятся из их имён
    # (`user_5_ab_n192.png`), в БД их адреса нет: без этой строки скрипт удалял бы
    # их как «сироты», и генерация повторялась бы при каждом push.
    used |= {push_icon_stored_name(name) for name in user_avatar_names}

    # Аватары групп лежат в том же каталоге, что и аватары пользователей, — без
    # них скрипт удалял бы файлы живых групп как «сироты».
    result = await session.execute(
        select(Chat.avatar_url, Chat.avatar_thumb_url).where(
            Chat.avatar_url.is_not(None)
        )
    )
    chat_avatar_names = _collect_names([row[0] for row in result.all()])
    chat_avatar_names |= _collect_names([row[1] for row in result.all()])
    used |= chat_avatar_names
    used |= {push_icon_stored_name(name) for name in chat_avatar_names}

    result = await session.execute(
        select(Story.media_url).where(Story.media_url.is_not(None))
    )
    used |= _collect_names([row[0] for row in result.all()])

    result = await session.execute(
        select(LinkPreview.image_url).where(LinkPreview.image_url.is_not(None))
    )
    used |= _collect_names([row[0] for row in result.all()])

    return used


def _find_orphans(used: set[str]) -> list[Path]:
    """Файлы в media и media/avatars, имени которых нет среди используемых."""
    orphans: list[Path] = []
    for folder in (MEDIA_DIR, MEDIA_DIR / "avatars"):
        if not folder.is_dir():
            continue
        for path in folder.iterdir():
            if path.is_file() and path.name not in used:
                orphans.append(path)
    return orphans


async def _run(delete: bool) -> None:
    async with db_helper.session_factory() as session:
        used = await _collect_used(session)
    orphans = _find_orphans(used)

    action = (
        "УДАЛЕНО" if delete else "найдено (dry-run, без --delete ничего не удаляется)"
    )
    print(f"Файлов со ссылками в БД: {len(used)}; {action}: {len(orphans)}")
    for path in sorted(orphans):
        if delete:
            path.unlink(missing_ok=True)
        print(f"  {path.relative_to(MEDIA_DIR.parent.parent)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--delete",
        action="store_true",
        help="реально удалять файлы (без флага — только показать)",
    )
    args = parser.parse_args()
    asyncio.run(_run(delete=args.delete))


if __name__ == "__main__":
    main()
