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
    # после смены ключа — перешифровать всё текущим ключом:
    poetry run python -m scripts.encrypt_texts --rotate

В контейнере:

    docker compose exec web poetry run python -m scripts.encrypt_texts --dry-run

ГРАБЛЯ, из-за которой здесь сырой SQL на чтение: через модель значение колонки
приходит УЖЕ расшифрованным (`EncryptedText`), поэтому «зашифровано ли» по нему не
узнать, а фильтр `LIKE 'enc:v1:%'` через модель ушёл бы в БД зашифрованным (тип
колонки шифрует и bind-параметры) и не совпал бы ни с чем. Поэтому читаем обычным
SQL, а пишем через модель (`update(Model)`) — там шифрование нужно.

ВАЖНО: перед запуском на проде сделайте свежий дамп БД — операция массовая
(хотя и сводится к UPDATE отдельных колонок).

Ротация ключа (``--rotate``) — отдельный сценарий: пишем ТЕКУЩИМ ключом, а читаем
текущим и ``AT_REST_KEY_PREVIOUS``. Порядок действий — ``docs/at-rest-rotation.md``.
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


def pending_prefix(*, rotate: bool) -> str:
    """Шаблон «уже сделано» для SQL-фильтра.

    * обычный прогон — всё, что не похоже на шифротекст (`enc:%`);
    * ``--rotate`` — всё, что помечено НЕ текущим ключом (старый формат `v1`,
      прошлый ключ, открытый текст): так видно остаток работы при ротации.
    """
    if not rotate:
        return f"{at_rest.MARKER}%"
    key = at_rest.encryption_key()
    identifier = at_rest.key_id(key) if key is not None else ""
    return f"{at_rest.PREFIX_V2}{identifier}:%"


def _pending_sql(target: Target, *, with_columns: bool, rotate: bool) -> str:
    """SQL для необработанных записей (имена таблиц/колонок — из кода, не из ввода)."""
    where = PENDING_WHERE.format(column=_quoted(target.column))
    table = _quoted(target.table)
    if with_columns:
        selected = ", ".join(_quoted(name) for name in (*target.pk, target.column))
        order = ", ".join(_quoted(name) for name in target.pk)
        return f"SELECT {selected} FROM {table} {where} ORDER BY {order} LIMIT :limit"
    return f"SELECT count(*) FROM {table} {where}"


async def count_pending(  # noqa: ANN001
    session, target: Target, *, rotate: bool = False
) -> int:
    """Сколько записей в колонке ещё требует работы."""
    result = await session.execute(
        sql_text(_pending_sql(target, with_columns=False, rotate=rotate)),
        {"prefix": pending_prefix(rotate=rotate)},
    )
    return int(result.scalar() or 0)


async def encrypt_batch(  # noqa: ANN001
    session, target: Target, batch: int, *, rotate: bool = False
) -> tuple[int, int]:
    """Обрабатывает одну порцию записей.

    Возвращает ``(просмотрено, перезаписано)``. В режиме ротации часть строк
    остаётся как есть: те, что уже под текущим ключом, и те, что не читаются ни
    одним известным ключом — их трогать нельзя, иначе зашифруем шифротекст и
    потеряем данные.
    """
    rows = (
        await session.execute(
            sql_text(_pending_sql(target, with_columns=True, rotate=rotate)),
            {"prefix": pending_prefix(rotate=rotate), "limit": batch},
        )
    ).all()
    if not rows:
        return 0, 0

    rewritten = 0
    for row in rows:
        values = dict(zip((*target.pk, target.column), row, strict=True))
        raw = values[target.column]
        if rotate and at_rest.encrypted_with_current_key(raw):
            continue
        if rotate:
            # Читаем значение известным ключом и пишем ОТКРЫТЫЙ текст: если
            # отдать модели шифротекст, `encrypt_text` увидит `enc:v2:` и
            # оставит его как есть — ротация была бы пустой.
            plain = at_rest.decrypt_text(raw)
            if at_rest.is_encrypted(raw) and plain == raw:
                logger.warning(
                    "Пропускаем %s (%s): значение не читается известными ключами",
                    target.name,
                    _pk_repr(target, values),
                )
                continue
            value = plain
        else:
            value = raw
        condition = [getattr(target.model, name) == values[name] for name in target.pk]
        # Пишем через модель: именно она шифрует значение перед отправкой в БД.
        await session.execute(
            update(target.model).where(*condition).values(**{target.column: value})
        )
        rewritten += 1
    await session.commit()
    return len(rows), rewritten


def _pk_repr(target: Target, values: dict[str, object]) -> str:
    """Первичный ключ строки — для понятных предупреждений в логе."""
    return ", ".join(f"{name}={values[name]}" for name in target.pk)


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
    parser.add_argument(
        "--rotate",
        action="store_true",
        help="перешифровать всё текущим ключом (после смены AT_REST_KEY)",
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

    if args.rotate:
        key = at_rest.encryption_key()
        logger.info(
            "Ротация: пишем ключом %s, читаем ключами: %s",
            at_rest.key_id(key) if key else "—",
            ", ".join(identifier for identifier, _ in at_rest.decryption_keys()),
        )

    targets = select_targets(args.only)
    total_pending = 0
    total_done = 0

    async with db_helper.session_factory() as session:
        plan: list[tuple[Target, int]] = []
        for target in targets:
            pending = await count_pending(session, target, rotate=args.rotate)
            total_pending += pending
            plan.append((target, pending))
            if pending:
                logger.info(
                    "%s: %s — к обработке %s", target.name, target.label, pending
                )

        if args.dry_run or total_pending == 0:
            logger.info("Всего записей к обработке: %s", total_pending)
            return 0

        for target, pending in plan:
            if not pending:
                continue
            seen = 0
            rewritten = 0
            while seen < pending:
                processed, changed = await encrypt_batch(
                    session, target, args.batch, rotate=args.rotate
                )
                if not processed:
                    break
                seen += processed
                rewritten += changed
            total_done += rewritten
            logger.info("%s: перезаписано %s из %s", target.name, rewritten, pending)

        logger.info("Готово: перезаписано записей — %s", total_done)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
