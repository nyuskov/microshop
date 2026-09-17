"""Выдаёт (или снимает) права администратора — в том числе по именам контактов.

Зачем: администратора в интерфейсе не заводят (в админской панели только
приглашения и жалобы), а имена контактов лежат ЗАШИФРОВАННЫМИ
(`contacts.custom_name` — `EncryptedText`), поэтому «выдать админа Маме» через
psql нельзя: в дампе видно `enc:v2:…`, а не имя. Скрипт читает контакты через
ORM (значит расшифровка работает), сверяет имена и выставляет флаг.

Роли (см. `core/models/user.py`):

* **администратор** (`is_admin`, по умолчанию) — жалобы, приглашения и обход
  экрана техработ; рубильник техработ ему НЕ доступен;
* **владелец** (`is_superuser`, флаг `--owner`) — всё то же плюс переключение
  техработ.

Запуск (нужна боевая БД, обычно внутри контейнера web на сервере):
    # посмотреть контакты владельца — имя, id, роль
    poetry run python -m scripts.set_admin --owner-phone +79109744376 --list

    # выдать админов нескольким контактам по имени
    poetry run python -m scripts.set_admin --owner-phone +79109744376 \\
        --name Мама --name Вася --name Слава

    # выдать напрямую по номеру телефона (и сделать владельцем)
    poetry run python -m scripts.set_admin --phone +79991234567 --owner

    # только показать, что будет сделано
    poetry run python -m scripts.set_admin --owner-phone +79109744376 \\
        --name Мама --dry-run

    # снять права (у владельца — флагом --owner)
    poetry run python -m scripts.set_admin --phone +79991234567 --revoke
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Contact, Profile, User, db_helper

logger = logging.getLogger(__name__)


def _digits(value: str | None) -> str:
    """Только цифры: в базе номера хранятся с пробелами, скобками и дефисами."""
    return re.sub(r"\D", "", value or "")


def _norm_name(value: str | None) -> str:
    """Имя для сравнения: регистр, ё и лишние пробелы не важны."""
    text = (value or "").replace("ё", "е").replace("Ё", "Е").lower()
    return re.sub(r"\s+", " ", text).strip()


async def _all_users(session: AsyncSession) -> list[User]:
    return list((await session.execute(select(User))).scalars().all())


async def _find_by_phone(session: AsyncSession, phone: str) -> User | None:
    needle = _digits(phone)
    if not needle:
        return None
    for user in await _all_users(session):
        if _digits(user.phone_number) == needle:
            return user
    return None


async def _profiles(session: AsyncSession) -> dict[int, Profile]:
    rows = (await session.execute(select(Profile))).scalars().all()
    return {profile.user_id: profile for profile in rows}


async def _contacts_of(session: AsyncSession, owner_id: int) -> list[Contact]:
    """Контакты владельца; `custom_name` приходит уже расшифрованным (ORM)."""
    rows = await session.execute(select(Contact).where(Contact.owner_id == owner_id))
    return list(rows.scalars().all())


def _display_name(user: User, profile: Profile | None) -> str:
    """Имя для человека в отчёте: из профиля, иначе логин/номер."""
    parts = [
        profile.first_name if profile else None,
        profile.last_name if profile else None,
    ]
    name = " ".join(part for part in parts if part)
    return name or user.username or user.phone_number or f"id {user.id}"


def _matches(name: str, wanted: str) -> bool:
    """Имя контакта подходит искомому: точно или как отдельное слово."""
    contact = _norm_name(name)
    needle = _norm_name(wanted)
    if not contact or not needle:
        return False
    return contact == needle or needle in re.split(r"[^\w\-]+", contact)


async def _resolve_targets(
    session: AsyncSession, *, owner: User, names: list[str]
) -> list[tuple[str, User]]:
    """Кого нашли по именам: пары «какое имя → пользователь».

    Сначала ищем в контактах владельца (личные псевдонимы вроде «Мама»), затем —
    по имени в профиле на случай, если контакт не заведён.
    """
    users = {user.id: user for user in await _all_users(session)}
    profiles = await _profiles(session)
    found: list[tuple[str, User]] = []
    seen: set[int] = set()

    contacts = await _contacts_of(session, owner.id)
    for wanted in names:
        target: User | None = None
        for contact in contacts:
            if contact.contact_user_id in seen:
                continue
            if _matches(contact.custom_name, wanted):
                target = users.get(contact.contact_user_id)
                break
        if target is None:
            for user in users.values():
                if user.id in seen or user.id == owner.id:
                    continue
                profile = profiles.get(user.id)
                candidates = [
                    _display_name(user, profile),
                    profile.first_name if profile else None,
                    user.username,
                ]
                if any(_matches(candidate, wanted) for candidate in candidates):
                    target = user
                    break
        if target is None:
            print(f"  ! {wanted}: не найден среди контактов и профилей")
            continue
        seen.add(target.id)
        found.append((wanted, target))
    return found


def _role_of(user: User) -> str:
    """Название роли для отчёта (пусто — обычный пользователь)."""
    if user.is_superuser:
        return "владелец"
    if user.is_admin:
        return "админ"
    return ""


async def _run(args: argparse.Namespace) -> int:
    value = not args.revoke
    async with db_helper.session_factory() as session:
        owner: User | None = None
        if args.owner_phone:
            owner = await _find_by_phone(session, args.owner_phone)
            if owner is None:
                print(f"Владелец {args.owner_phone} не найден.")
                return 1

        if args.search:
            # Поиск по имени/фамилии/логину: контакт мог быть заведён без
            # псевдонима, и тогда «Дмитрий Быковский» ищется только так.
            needle = _norm_name(args.search)
            contact_ids: set[int] = set()
            if owner is not None:
                contact_ids = {
                    contact.contact_user_id
                    for contact in await _contacts_of(session, owner.id)
                }
            profiles = await _profiles(session)
            print(f"Поиск «{args.search}»:")
            for user in await _all_users(session):
                profile = profiles.get(user.id)
                candidates = [
                    _display_name(user, profile),
                    profile.first_name if profile else None,
                    profile.last_name if profile else None,
                    user.username,
                ]
                if not any(
                    needle and needle in _norm_name(item) for item in candidates
                ):
                    continue
                marks = []
                if user.id in contact_ids:
                    marks.append("в контактах")
                role = _role_of(user)
                if role:
                    marks.append(role)
                print(
                    f"  id={user.id} {_display_name(user, profile)} / {user.username}"
                    f" {' '.join(marks)}"
                )
            return 0

        if args.list:
            if owner is None:
                print("Для --list нужен --owner-phone.")
                return 1
            profiles = await _profiles(session)
            users = {user.id: user for user in await _all_users(session)}
            print(f"Контакты {_display_name(owner, profiles.get(owner.id))}:")
            for contact in await _contacts_of(session, owner.id):
                user = users.get(contact.contact_user_id)
                if user is None:
                    continue
                print(
                    f"  {contact.custom_name or '(без имени)':<24} "
                    f"{_display_name(user, profiles.get(user.id)):<28} "
                    f"id={user.id} {_role_of(user) or '—'}"
                )
            return 0

        targets: list[tuple[str, User]] = []
        if args.name:
            if owner is None:
                print("Для поиска по именам нужен --owner-phone.")
                return 1
            targets = await _resolve_targets(session, owner=owner, names=args.name)
        if args.phone:
            user = await _find_by_phone(session, args.phone)
            if user is None:
                print(f"Пользователь {args.phone} не найден.")
                return 1
            targets.append((args.phone, user))

        if not targets:
            print("Никого не выбрали: укажите --name (с --owner-phone) или --phone.")
            return 1

        profiles = await _profiles(session)
        changed = 0
        role_title = "владелец" if args.owner else "администратор"
        print(
            f"Роль: {role_title}" if not args.revoke else f"Снятие роли: {role_title}"
        )
        print("Итог:")
        for label, user in targets:
            who = _display_name(user, profiles.get(user.id))
            if args.owner:
                before, after = user.is_superuser, value
            else:
                before, after = user.is_admin, value
            if args.dry_run:
                action = f"уже {role_title}" if before and after else "—"
                print(f"  {label}: {who} (id={user.id}) {action} [dry-run]")
                continue
            if before == after:
                print(f"  {label}: {who} (id={user.id}) — без изменений")
                continue
            if args.owner:
                user.is_superuser = after
            else:
                user.is_admin = after
            changed += 1
            print(f"  {label}: {who} (id={user.id}) — {'выдан' if after else 'снят'}")
        if not args.dry_run and changed:
            await session.commit()
            logger.warning(
                "Роль изменена: %s (%d) — %s",
                ", ".join(str(user.id) for _, user in targets),
                changed,
                f"{'выдача' if value else 'снятие'} {role_title}",
            )
        if not args.dry_run:
            print(f"Изменено записей: {changed}.")
        return 0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--owner-phone",
        dest="owner_phone",
        default=None,
        help="Чей список контактов смотрим (номер владельца, чьи имена передаём).",
    )
    parser.add_argument(
        "--name",
        dest="name",
        action="append",
        default=[],
        help="Имя контакта (можно повторять). Сравнение без учёта регистра и ё.",
    )
    parser.add_argument(
        "--phone",
        dest="phone",
        default=None,
        help="Выдать/снять права напрямую по номеру телефона (без контактов).",
    )
    parser.add_argument(
        "--list",
        dest="list",
        action="store_true",
        help="Показать контакты владельца и их текущий статус, ничего не меняя.",
    )
    parser.add_argument(
        "--search",
        dest="search",
        default=None,
        help="Найти пользователей по имени/фамилии/логину (ничего не меняет).",
    )
    parser.add_argument(
        "--owner",
        dest="owner",
        action="store_true",
        help="Выдать роль владельца (is_superuser) вместо администратора",
    )
    parser.add_argument(
        "--revoke",
        dest="revoke",
        action="store_true",
        help="Снять роль (по умолчанию — выдать).",
    )
    parser.add_argument(
        "--dry-run",
        dest="dry_run",
        action="store_true",
        help="Только показать, что будет сделано.",
    )
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    raise SystemExit(asyncio.run(_run(_parse_args())))


if __name__ == "__main__":
    main()
