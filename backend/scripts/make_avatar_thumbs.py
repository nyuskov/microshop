"""Досоздаёт миниатюры аватаров и иконки уведомлений для уже загруженных файлов.

Миниатюры (``avatar_thumb_url``) появились позже самих аватаров: у файлов,
загруженных до этого, их нет, и клиент тянет оригинал (несколько мегабайт) на
кружок 40–56px. Скрипт проходит по пользователям и группам с аватаром без
миниатюры, делает миниатюру из файла на диске и проставляет ссылку в БД.

Второй случай, не менее важный: ссылка в БД есть, а ФАЙЛА миниатюры нет (так
случилось на проде, когда ночная очистка media удалила миниатюры как «сироты» -
тогда клиент показывает битую картинку вместо аватара). Такой аватар скрипт
тоже считает «без миниатюры» и делает файл заново, обновив ссылку.

Заодно делаются «иконки уведомлений» (``_n192.png`` рядом с аватаром): их адрес
выводится из имени аватара и в БД не хранится, поэтому достаточно файла. Без них
в пуше показывается полный аватар — крупнее, чем хотелось бы (генерация при
отправке работает, но первое уведомление ждёт её).

Запуск (нужен доступ к БД и каталогу media, например внутри контейнера web):
    poetry run python -m scripts.make_avatar_thumbs            # dry-run
    poetry run python -m scripts.make_avatar_thumbs --apply    # с записью

Скрипт идемпотентен: повторный запуск ничего не делает (копии уже есть). В
режиме dry-run файлы всё равно создаются (как и раньше) — не трогается только БД.
"""

import argparse
import asyncio
from pathlib import Path

from sqlalchemy import select

from core.avatar_store import (
    AVATAR_DIR,
    AVATAR_URL_PREFIX,
    make_avatar_thumb,
    make_push_icon,
    push_icon_stored_name,
    thumb_stored_name,
)
from core.media_crypto import read_file, write_file
from core.models import Chat, User, db_helper


def _thumb_missing(row: User | Chat) -> bool:
    """Нужна ли миниатюра: ссылки нет или файла по ссылке нет.

    Второй случай — потерянный файл: ссылка в БД осталась (например, файл удалила
    очистка media), и клиент показывает битую картинку вместо аватара.
    """
    url = row.avatar_thumb_url
    if not url:
        return True
    return not (AVATAR_DIR / Path(url).name).is_file()


def _make_thumb_for(avatar_url: str) -> str | None:
    """Делает миниатюру для файла аватара. None — файла нет или он не картинка."""
    source = AVATAR_DIR / avatar_url.rsplit("/", 1)[-1]
    if not source.is_file():
        return None
    # read_file расшифровывает оригинал, если он лежит под AT_REST_KEY, а
    # write_file шифрует миниатюру тем же ключом (см. core/media_crypto.py).
    thumb = make_avatar_thumb(read_file(source))
    if thumb is None:
        return None
    thumb_data, thumb_ext = thumb
    thumb_name = thumb_stored_name(source.name, thumb_ext)
    write_file(AVATAR_DIR / thumb_name, thumb_data)
    return f"{AVATAR_URL_PREFIX}{thumb_name}"


def _make_push_icon_for(avatar_url: str) -> str | None:
    """Делает иконку уведомления. None — уже есть, файла нет или не картинка."""
    source = AVATAR_DIR / avatar_url.rsplit("/", 1)[-1]
    if not source.is_file():
        return None
    name = push_icon_stored_name(source.name)
    if (AVATAR_DIR / name).is_file():
        return None
    icon = make_push_icon(read_file(source))
    if icon is None:
        return None
    write_file(AVATAR_DIR / name, icon)
    return f"{AVATAR_URL_PREFIX}{name}"


async def _run(apply: bool) -> None:
    made = 0
    icons = 0
    broken = 0
    async with db_helper.session_factory() as session:
        users = (
            (await session.execute(select(User).where(User.avatar_url.is_not(None))))
            .scalars()
            .all()
        )
        chats = (
            (await session.execute(select(Chat).where(Chat.avatar_url.is_not(None))))
            .scalars()
            .all()
        )
        rows: list[User | Chat] = [*users, *chats]

        for row in rows:
            avatar_url = row.avatar_url or ""

            if _thumb_missing(row):
                thumb_url = _make_thumb_for(avatar_url)
                if thumb_url is None:
                    # Файла нет или он не картинка — иконку для него тоже не сделать.
                    broken += 1
                    print(f"  пропуск: файл аватара недоступен ({avatar_url})")
                    continue
                made += 1
                if apply:
                    row.avatar_thumb_url = thumb_url
                print(f"  миниатюра: {avatar_url} -> {thumb_url}")

            icon_url = _make_push_icon_for(avatar_url)
            if icon_url is not None:
                icons += 1
                print(f"  иконка уведомления: {avatar_url} -> {icon_url}")

        if apply:
            await session.commit()

    mode = "записано" if apply else "dry-run (без изменений, нужен --apply)"
    print(
        f"Миниатюр сделано: {made}; иконок уведомления: {icons}; "
        f"файл не читается: {broken}; режим: {mode}"
    )


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
