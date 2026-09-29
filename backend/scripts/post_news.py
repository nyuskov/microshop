"""Публикует пост в канал «Новости приложения» от имени владельца.

Правило проекта: каждая заметная для человека правка описывается постом в канале
новостей (id 16) — простым языком, без внутренних деталей (см.
``docs/changelog.md``). Из приложения это делает владелец руками; скрипт нужен,
чтобы то же самое можно было сделать при выкатке, не заходя в интерфейс.

Как: находим канал и аккаунт владельца и отправляем текст ТОЙ ЖЕ функцией, что и
обычное сообщение из API (``messages.crud.send_text_message``). Значит пост
попадает в ленту канала, шифруется «в покое» и уходит подписчикам (push) ровно так
же, как написанный из приложения. Токены не нужны: скрипт работает внутри
приложения, с доступом к БД.

Запуск (в контейнере ``web``, где есть доступ к БД):

    poetry run python -m scripts.post_news --text "🎨 Что нового"
    cat /tmp/post.md | poetry run python -m scripts.post_news --stdin
    poetry run python -m scripts.post_news --file /tmp/post.md --channel-id 16
    poetry run python -m scripts.post_news --text "..." --phone +79991234567

В ответ печатается id сообщения — его же вписываем в ``docs/changelog.md``
(«опубликован пост #NNN»).
"""

import argparse
import asyncio
import sys
from pathlib import Path

from sqlalchemy import select

from api_v1.messages import crud as messages_crud
from core.models import Chat, User, db_helper

#: Канал новостей приложения (см. README: «Канал “Новости приложения” (id 16)»).
DEFAULT_CHANNEL_ID = 16


def _author_query(phone: str | None):
    """Запрос на автора поста: владелец сервиса или явно указанный номер."""
    if phone:
        return select(User).where(User.phone_number == phone)
    return select(User).where(User.is_superuser.is_(True)).order_by(User.id)


async def _post(*, channel_id: int, text: str, phone: str | None) -> int:
    """Публикует текст в канал и возвращает id сообщения."""
    async with db_helper.session_factory() as session:
        chat = await session.get(Chat, channel_id)
        if chat is None:
            raise SystemExit(f"Чат id={channel_id} не найден")
        if not chat.is_channel:
            raise SystemExit(
                f"Чат id={channel_id} — не канал: посты публикуем только в канале"
            )
        author = (await session.execute(_author_query(phone))).scalars().first()
        if author is None:
            raise SystemExit(
                "Не найден аккаунт владельца (is_superuser) — укажите --phone"
            )
        message = await messages_crud.send_text_message(
            session, chat_id=channel_id, text=text, user_id=author.id
        )
        return int(message["id"])


def _read_text(args: argparse.Namespace) -> str:
    """Текст поста: из аргумента, файла или stdin (удобно с heredoc/конвейером)."""
    if args.text:
        return args.text
    if args.file:
        return Path(args.file).read_text(encoding="utf-8")
    if args.stdin or not sys.stdin.isatty():
        return sys.stdin.read()
    raise SystemExit("Не задан текст: --text, --file или stdin")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--text", default=None, help="Текст поста одной строкой.")
    parser.add_argument("--file", default=None, help="Файл с текстом поста (UTF-8).")
    parser.add_argument(
        "--stdin",
        action="store_true",
        help="Читать текст из stdin (cat post.md | … --stdin).",
    )
    parser.add_argument(
        "--channel-id",
        dest="channel_id",
        type=int,
        default=DEFAULT_CHANNEL_ID,
        help=f"id канала для публикации (по умолчанию {DEFAULT_CHANNEL_ID}).",
    )
    parser.add_argument(
        "--phone",
        default=None,
        help="Номер владельца, от чьего имени публикуем (по умолчанию — первый "
        "аккаунт с правами владельца).",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    text = _read_text(args).strip()
    if not text:
        raise SystemExit("Пустой текст поста — публиковать нечего")
    message_id = asyncio.run(
        _post(channel_id=args.channel_id, text=text, phone=args.phone)
    )
    print(f"Опубликовано: пост #{message_id} в канале id={args.channel_id}")


if __name__ == "__main__":
    main()
