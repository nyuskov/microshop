"""Досоздаёт миниатюры аватаров для уже загруженных файлов.

Миниатюры (``avatar_thumb_url``) появились позже самих аватаров: у файлов,
загруженных до этого, их нет, и клиент тянет оригинал (несколько мегабайт) на
кружок 40–56px. Скрипт проходит по пользователям и группам с аватаром без
миниатюры, делает миниатюру из файла на диске и проставляет ссылку в БД.

Запуск (нужен доступ к БД и каталогу media, например внутри контейнера web):
    poetry run python -m scripts.make_avatar_thumbs            # dry-run
    poetry run python -m scripts.make_avatar_thumbs --apply    # с записью

Скрипт идемпотентен: повторный запуск ничего не делает (миниатюра уже есть).
"""

import argparse
import asyncio

from sqlalchemy import select

from core.avatar_store import (
    AVATAR_DIR,
    AVATAR_URL_PREFIX,
    make_avatar_thumb,
    thumb_stored_name,
)
from core.models import Chat, User, db_helper


def _make_thumb_for(avatar_url: str) -> str | None:
    """Делает миниатюру для файла аватара. None — файла нет или он не картинка."""
    source = AVATAR_DIR / avatar_url.rsplit("/", 1)[-1]
    if not source.is_file():
        return None
    thumb = make_avatar_thumb(source.read_bytes())
    if thumb is None:
        return None
    thumb_data, thumb_ext = thumb
    thumb_name = thumb_stored_name(source.name, thumb_ext)
    (AVATAR_DIR / thumb_name).write_bytes(thumb_data)
    return f"{AVATAR_URL_PREFIX}{thumb_name}"


async def _run(apply: bool) -> None:
    made = 0
    broken = 0
    async with db_helper.session_factory() as session:
        users = (
            (
                await session.execute(
                    select(User).where(
                        User.avatar_url.is_not(None),
                        User.avatar_thumb_url.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        chats = (
            (
                await session.execute(
                    select(Chat).where(
                        Chat.avatar_url.is_not(None),
                        Chat.avatar_thumb_url.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )

        for row in [*users, *chats]:
            thumb_url = _make_thumb_for(row.avatar_url or "")
            if thumb_url is None:
                broken += 1
                print(f"  пропуск: файл аватара недоступен ({row.avatar_url})")
                continue
            made += 1
            if apply:
                row.avatar_thumb_url = thumb_url
            print(f"  миниатюра: {row.avatar_url} -> {thumb_url}")

        if apply:
            await session.commit()

    mode = "записано" if apply else "dry-run (без изменений, нужен --apply)"
    print(f"Миниатюр сделано: {made}; файл не читается: {broken}; режим: {mode}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="записать ссылки на миниатюры в БД (без флага — только показать)",
    )
    args = parser.parse_args()
    asyncio.run(_run(apply=args.apply))


if __name__ == "__main__":
    main()
