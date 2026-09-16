"""Переводит уже лежащие на диске файлы media в зашифрованный вид (at-rest).

Зачем: шифрование включается переменной `AT_REST_KEY`, и с этого момента
зашифрованными пишутся только НОВЫЕ файлы (вложения, аватары, истории,
предпросмотры). Старые остаются открытыми — именно поэтому включение ключа
безопасно (ничего не ломается), но защита неполная, пока каталог не перешифрован.

Скрипт идемпотентен: файлы, начинающиеся с заголовка контейнера (`encf:v1:`),
пропускаются, поэтому его можно запускать повторно и после сбоя. Каждый файл
пишется атомарно (временный файл + `rename`), так что клиент не увидит
наполовину перешифрованный вложение даже во время работы скрипта.

    cd backend
    # посмотреть, сколько файлов будет затронуто (ничего не меняет):
    poetry run python -m scripts.encrypt_media --dry-run
    # перешифровать:
    poetry run python -m scripts.encrypt_media

В контейнере:

    docker compose exec web poetry run python -m scripts.encrypt_media --dry-run

Про восстановление: ключ нужен для ЧТЕНИЯ, поэтому без него зашифрованные файлы
не открыть (в интерфейсе они будут отдавать 503). Ключ храните отдельно от
бэкапов — иначе смысл шифрования теряется.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

# Запуск как `python -m scripts.encrypt_media` из каталога backend.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core import at_rest, media_crypto  # noqa: E402
from core.media_store import MEDIA_DIR  # noqa: E402

logger = logging.getLogger("encrypt_media")

#: Через сколько файлов писать прогресс.
PROGRESS_EVERY = 200


def pending_files(root: Path) -> list[Path]:
    """Файлы каталога, которые ещё не зашифрованы (отсортированы по имени)."""
    found: list[Path] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name.startswith("."):
            # Пропускаем временные файлы: они появляются на миг при записи.
            continue
        if media_crypto.is_encrypted_file(path):
            continue
        found.append(path)
    return found


def encrypt_file(path: Path) -> int:
    """Шифрует один файл. Возвращает размер открытых данных (байт)."""
    data = path.read_bytes()
    media_crypto.write_file(path, data)
    return len(data)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="только показать, сколько файлов не зашифровано",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="обработать не больше N файлов (0 — все)",
    )
    parser.add_argument(
        "--dir",
        default=str(MEDIA_DIR),
        help=f"каталог медиа (по умолчанию {MEDIA_DIR})",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if not at_rest.is_enabled():
        logger.error(
            "AT_REST_KEY не задан — шифрование выключено, шифровать нечем. "
            "Сгенерируйте ключ (openssl rand -hex 32) и добавьте в окружение."
        )
        return 1

    root = Path(args.dir)
    if not root.is_dir():
        logger.error("Каталог не найден: %s", root)
        return 1

    files = pending_files(root)
    logger.info("Файлов без шифрования: %s", len(files))
    if args.dry_run or not files:
        return 0

    if args.limit > 0:
        files = files[: args.limit]
        logger.info("Ограничение --limit: обработаем %s", len(files))

    done = 0
    total_bytes = 0
    errors = 0
    for path in files:
        try:
            total_bytes += encrypt_file(path)
        except OSError as exc:
            # Один «занятый» файл не повод бросать остальные: дошифруем, что
            # сможем, а причину покажем.
            errors += 1
            logger.warning("Не удалось зашифровать %s: %s", path.name, exc)
            continue
        done += 1
        if done % PROGRESS_EVERY == 0:
            logger.info("Зашифровано: %s из %s", done, len(files))

    logger.info(
        "Готово: зашифровано %s файлов (%s МиБ), ошибок: %s",
        done,
        round(total_bytes / (1024 * 1024), 1),
        errors,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
