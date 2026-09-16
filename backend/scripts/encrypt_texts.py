"""Переводит уже существующий пользовательский текст в зашифрованный вид (at-rest).

Зачем: шифрование включается переменной `AT_REST_KEY`, и с этого момента
зашифрованными пишутся только НОВЫЕ записи. Старые остаются открытыми — поэтому
включение ключа безопасно (ничего не ломается), но защита неполная, пока история
не перешифрована.

Скрипт табличный: список колонок берётся из `TARGETS` ниже, так что одна команда
закрывает и тексты сообщений, и черновики, и комментарии каналов, и подписи
историй, и личные имена контактов, и заметки модерации, и профиль. Идемпотентен:
уже зашифрованное (префикс `enc:v1:`) пропускает, поэтому его можно запускать
повторно и после сбоя.

    cd backend
    # посмотреть, сколько записей будет затронуто (ничего не меняет):
    poetry run python -m scripts.encrypt_texts --dry-run
    # перешифровать всё:
    poetry run python -m scripts.encrypt_texts
    # только одну колонку (или одну таблицу):
    poetry run python -m scripts.encrypt_texts --only messages.text

В контейнере:

    docker compose exec web poetry run python -m scripts.encrypt_texts --dry-run

ГРАБЛЯ, из-за которой здесь сырой SQL на чтение: через модель значение колонки
приходит УЖЕ расшифрованным (`EncryptedText`), поэтому «зашифровано ли» по нему не
узнать, а фильтр `LIKE 'enc:v1:%'` через модель ушёл бы в БД зашифрованным (тип
колонки шифрует и bind-параметры) и не совпал бы ни с чем. Поэтому читаем обычным
SQL, а пишем через модель (`update(Model)`) — там шифрование нужно.

ВАЖНО: перед запуском на проде сделайте свежий дамп БД — операция массовая
(хотя и сводится к UPDATE отдельных колонок).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Запуск как `python -m scripts.encrypt_texts` из каталога backend.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text as sql_text  # noqa: E402
from sqlalchemy import update  # noqa: E402

from core import at_rest  # noqa: E402
from core.models import (  # noqa: E402
    ChannelComment,
    ChannelSuggestion,
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
from core.models.db_helper import db_helper  # noqa: E402

logger = logging.getLogger("encrypt_texts")

#: Размер порции: одна транзакция на N записей — чтобы не держать блокировку
#: на всю таблицу и видеть прогресс.
DEFAULT_BATCH = 500


@dataclass(frozen=True)
class Target:
    """Колонка, которую перешифровываем."""

    table: str
    column: str
    model: Any
    #: Первичный ключ таблицы (у черновиков и контактов он составной).
    pk: tuple[str, ...]
    label: str

    @property
    def name(self) -> str:
        """Имя вида `таблица.колонка` — для `--only` и логов."""
        return f"{self.table}.{self.column}"


#: Всё, что шифруется «в покое» (список должен совпадать с моделями: колонки с
#: типом `EncryptedText`). Тест `tests/test_at_rest_texts.py` это сверяет.
TARGETS: tuple[Target, ...] = (
    Target("messages", "text", Message, ("id",), "тексты сообщений"),
    Target(
        "message_drafts",
        "text",
        MessageDraft,
        ("user_id", "chat_id"),
        "черновики сообщений",
    ),
    Target("channel_comments", "text", ChannelComment, ("id",), "комментарии каналов"),
    Target(
        "channel_suggestions",
        "text",
        ChannelSuggestion,
        ("id",),
        "предложенные посты",
    ),
    Target("stories", "caption", Story, ("id",), "подписи историй"),
    Target(
        "contacts",
        "custom_name",
        Contact,
        ("owner_id", "contact_user_id"),
        "личные имена контактов",
    ),
    Target("user_reports", "comment", UserReport, ("id",), "комментарии к жалобам"),
    Target("user_reports", "note", UserReport, ("id",), "заметки по жалобам"),
    Target("moderation_actions", "note", ModerationAction, ("id",), "журнал модерации"),
    Target(
        "registration_invites",
        "note",
        RegistrationInvite,
        ("id",),
        "заметки к приглашениям",
    ),
    Target("user", "first_name", User, ("id",), "имена пользователей"),
    Target("user", "last_name", User, ("id",), "фамилии пользователей"),
    Target("user", "status", User, ("id",), "статусы пользователей"),
    Target("profile", "bio", Profile, ("id",), "«о себе» в профиле"),
    Target("link_previews", "title", LinkPreview, ("id",), "заголовки карточек ссылок"),
    Target(
        "link_previews", "description", LinkPreview, ("id",), "описания карточек ссылок"
    ),
    Target(
        "link_previews", "site_name", LinkPreview, ("id",), "имена сайтов в карточках"
    ),
)

#: Обычные (не зашифрованные) значения: пустые строки не трогаем.
PENDING_WHERE = (
    "WHERE {column} IS NOT NULL AND {column} <> '' AND {column} NOT LIKE :prefix"
)


def _quoted(name: str) -> str:
    """Имя таблицы/колонки в кавычках.

    Кавычки обязательны: `user` — зарезервированное слово PostgreSQL, без них
    запрос падает на «column ... does not exist». Имена берутся из кода
    (`TARGETS`), а не из ввода пользователя.
    """
    return f'"{name}"'


def _pending_sql(target: Target, *, with_columns: bool) -> str:
    """SQL для необработанных записей (имена таблиц/колонок — из кода, не из ввода)."""
    where = PENDING_WHERE.format(column=_quoted(target.column))
    table = _quoted(target.table)
    if with_columns:
        selected = ", ".join(_quoted(name) for name in (*target.pk, target.column))
        order = ", ".join(_quoted(name) for name in target.pk)
        return f"SELECT {selected} FROM {table} {where} ORDER BY {order} LIMIT :limit"
    return f"SELECT count(*) FROM {table} {where}"


async def count_pending(session, target: Target) -> int:  # noqa: ANN001
    """Сколько записей в колонке ещё не зашифровано."""
    result = await session.execute(
        sql_text(_pending_sql(target, with_columns=False)),
        {"prefix": f"{at_rest.PREFIX}%"},
    )
    return int(result.scalar() or 0)


async def encrypt_batch(session, target: Target, batch: int) -> int:  # noqa: ANN001
    """Шифрует одну порцию записей. Возвращает, сколько затронуто."""
    rows = (
        await session.execute(
            sql_text(_pending_sql(target, with_columns=True)),
            {"prefix": f"{at_rest.PREFIX}%", "limit": batch},
        )
    ).all()
    if not rows:
        return 0

    for row in rows:
        values = dict(zip((*target.pk, target.column), row, strict=True))
        condition = [getattr(target.model, name) == values[name] for name in target.pk]
        # Пишем через модель: именно она шифрует значение перед отправкой в БД.
        await session.execute(
            update(target.model)
            .where(*condition)
            .values(**{target.column: values[target.column]})
        )
    await session.commit()
    return len(rows)


def select_targets(only: str | None) -> tuple[Target, ...]:
    """Отбирает колонки по `--only` (``таблица``, ``таблица.колонка`` или метка).

    Сначала ищем точное совпадение: «user» должно дать три колонки таблицы
    `user`, а не ещё и `user_reports`. Если точного нет — берём подстроку
    (удобно для «caption» или «reports»).
    """
    if not only:
        return TARGETS
    needle = only.strip().lower()
    exact = tuple(
        target
        for target in TARGETS
        if needle in (target.table.lower(), target.name.lower(), target.label.lower())
    )
    if exact:
        return exact
    loose = tuple(
        target
        for target in TARGETS
        if needle in target.name.lower() or needle in target.label.lower()
    )
    if loose:
        return loose
    known = ", ".join(sorted({target.table for target in TARGETS}))
    raise SystemExit(f"Неизвестная цель {only!r}. Доступны таблицы: {known}")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="только показать, сколько записей не зашифровано",
    )
    parser.add_argument(
        "--batch",
        type=int,
        default=DEFAULT_BATCH,
        help=f"размер порции (по умолчанию {DEFAULT_BATCH})",
    )
    parser.add_argument(
        "--only",
        default=None,
        help="обработать только одну таблицу/колонку (например, user.status)",
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

    targets = select_targets(args.only)
    total_pending = 0
    total_done = 0

    async with db_helper.session_factory() as session:
        plan: list[tuple[Target, int]] = []
        for target in targets:
            pending = await count_pending(session, target)
            total_pending += pending
            plan.append((target, pending))
            if pending:
                logger.info(
                    "%s: %s — не зашифровано %s", target.name, target.label, pending
                )

        if args.dry_run or total_pending == 0:
            logger.info("Всего записей без шифрования: %s", total_pending)
            return 0

        for target, pending in plan:
            if not pending:
                continue
            done = 0
            while done < pending:
                affected = await encrypt_batch(session, target, args.batch)
                if not affected:
                    break
                done += affected
            total_done += done
            logger.info("%s: зашифровано %s из %s", target.name, done, pending)

        logger.info("Готово: зашифровано записей — %s", total_done)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
