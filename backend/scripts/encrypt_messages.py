"""Переводит уже существующие сообщения в зашифрованный вид (at-rest).

ПРЕДПОЧТИТЕЛЬНЫЙ СПОСОБ: `python -m scripts.encrypt_texts` — он закрывает не
только тексты сообщений, но и черновики, комментарии каналов, подписи историй,
личные имена контактов, заметки модерации, профиль и карточки ссылок. Этот файл
оставлен для случая, когда нужно перешифровать ровно одну таблицу (messages).

Зачем: шифрование включается переменной `AT_REST_KEY`, и с этого момента
зашифровываются только НОВЫЕ сообщения. Старые остаются открытыми — именно
поэтому включение ключа безопасно (ничего не ломается), но защита получается
неполной, пока история не перешифрована.

Скрипт идемпотентен: уже зашифрованные строки пропускает (их видно по префиксу
`enc:v1:`), поэтому его можно запускать повторно и после сбоя.

    cd backend
    # посмотреть, сколько сообщений будет затронуто (ничего не меняет):
    poetry run python -m scripts.encrypt_messages --dry-run
    # перешифровать (порциями, с логом прогресса):
    poetry run python -m scripts.encrypt_messages

В контейнере dev-стека:

    docker compose exec web poetry run python -m scripts.encrypt_messages --dry-run

ГРАБЛЯ, из-за которой здесь сырой SQL: через модель значение колонки приходит
УЖЕ расшифрованным (`EncryptedText`), поэтому «зашифровано ли» по нему не узнать,
а фильтр `LIKE 'enc:v1:%'` через модель ушёл бы в БД зашифрованным (тип колонки
шифрует и bind-параметры) и не совпал бы ни с чем. Поэтому читаем обычным SQL
(`SELECT id, text FROM messages`), а пишем через модель — там шифрование нужно.

ВАЖНО: перед запуском на проде сделайте свежий дамп БД — операция массовая
(хотя и сводится к UPDATE одной колонки).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

# Запуск как `python -m scripts.encrypt_messages` из каталога backend.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text as sql_text  # noqa: E402
from sqlalchemy import update  # noqa: E402

from core import at_rest  # noqa: E402
from core.models import Message  # noqa: E402
from core.models.db_helper import db_helper  # noqa: E402

logger = logging.getLogger("encrypt_messages")

#: Размер порции: одна транзакция на N сообщений — чтобы не держать блокировку
#: на всю таблицу и видеть прогресс.
DEFAULT_BATCH = 500

PENDING_SQL = (
    "SELECT count(*) FROM messages "
    "WHERE text IS NOT NULL AND text <> '' AND text NOT LIKE :prefix"
)
BATCH_SQL = (
    "SELECT id, text FROM messages "
    "WHERE text IS NOT NULL AND text <> '' AND text NOT LIKE :prefix "
    "ORDER BY id LIMIT :limit"
)


async def count_pending(session) -> int:  # noqa: ANN001
    """Сколько сообщений ещё не зашифровано."""
    result = await session.execute(
        sql_text(PENDING_SQL), {"prefix": f"{at_rest.MARKER}%"}
    )
    return int(result.scalar() or 0)


async def encrypt_batch(session, batch: int) -> int:  # noqa: ANN001
    """Шифрует одну порцию сообщений. Возвращает, сколько затронуто."""
    rows = (
        await session.execute(
            sql_text(BATCH_SQL), {"prefix": f"{at_rest.MARKER}%", "limit": batch}
        )
    ).all()
    if not rows:
        return 0
    for message_id, raw_value in rows:
        await session.execute(
            update(Message).where(Message.id == message_id).values(text=raw_value)
        )
    await session.commit()
    return len(rows)


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="только показать, сколько сообщений не зашифровано",
    )
    parser.add_argument(
        "--batch",
        type=int,
        default=DEFAULT_BATCH,
        help=f"размер порции (по умолчанию {DEFAULT_BATCH})",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if not at_rest.is_enabled():
        logger.error(
            "AT_REST_KEY не задан — шифрование выключено, перешифровывать нечего. "
            "Сгенерируйте ключ (openssl rand -hex 32) и добавьте в окружение."
        )
        return 1

    if args.batch < 1:
        logger.error("--batch должен быть положительным")
        return 1

    async with db_helper.session_factory() as session:
        pending = await count_pending(session)
        logger.info("Сообщений без шифрования: %s", pending)
        if args.dry_run or pending == 0:
            return 0

        done = 0
        while done < pending:
            affected = await encrypt_batch(session, args.batch)
            if not affected:
                break
            done += affected
            logger.info("Зашифровано: %s из %s", done, pending)
        logger.info("Готово: зашифровано %s сообщений", done)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
