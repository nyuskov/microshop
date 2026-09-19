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

Список «используемых» имён берётся из ``core.media_usage`` — оттуда же, откуда
его берёт периодическая задача воркера (``tasks.media_tasks``). Своя копия
выборок в скрипте уже расходилась с задачей, и ночная очистка удаляла живые
файлы: стикеры библиотеки и иконки уведомлений.
"""

import argparse
import asyncio
from pathlib import Path

from core.media_usage import collect_used_media_names
from core.models import db_helper

MEDIA_DIR = Path(__file__).resolve().parent.parent / "media"


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
        used = await collect_used_media_names(session)
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
