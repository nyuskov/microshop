"""Создаёт персональную ссылку-приглашение на регистрацию.

Публичная регистрация выключена (``REGISTRATION_ENABLED=false``): единственный
способ завести новый аккаунт — одноразовая ссылка `/invite/<token>`, которую
владелец сервиса генерирует этим скриптом и передаёт лично приглашённому
человеку (в личном чате, а не публично — иначе это была бы открытая
регистрация).

Запуск (нужен доступ к БД, например внутри контейнера web):
    poetry run python -m scripts.create_invite
    poetry run python -m scripts.create_invite --note "для Пети"
    poetry run python -m scripts.create_invite --phone +79991234567
    poetry run python -m scripts.create_invite --expires-days 7
    poetry run python -m scripts.create_invite --base-url https://pismo.space
"""

import argparse
import asyncio
import secrets
from datetime import datetime, timedelta, timezone

from core.models import RegistrationInvite, db_helper

DEFAULT_BASE_URL = "https://pismo.space"


async def _create_invite(
    *,
    phone_number: str | None,
    note: str | None,
    expires_days: int | None,
) -> RegistrationInvite:
    expires_at = None
    if expires_days is not None:
        expires_at = datetime.now(timezone.utc) + timedelta(days=expires_days)

    invite = RegistrationInvite(
        token=secrets.token_urlsafe(32),
        phone_number=phone_number,
        note=note,
        expires_at=expires_at,
    )
    async with db_helper.session_factory() as session:
        session.add(invite)
        await session.commit()
        await session.refresh(invite)
    return invite


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--phone",
        dest="phone",
        default=None,
        help="Закрепить приглашение за конкретным номером (+7XXXXXXXXXX).",
    )
    parser.add_argument(
        "--note",
        dest="note",
        default=None,
        help="Заметка для себя (не показывается приглашённому), например 'для Пети'.",
    )
    parser.add_argument(
        "--expires-days",
        dest="expires_days",
        type=int,
        default=None,
        help="Срок действия ссылки в днях (по умолчанию — бессрочно).",
    )
    parser.add_argument(
        "--base-url",
        dest="base_url",
        default=DEFAULT_BASE_URL,
        help=f"Домен для готовой ссылки (по умолчанию {DEFAULT_BASE_URL}).",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    invite = asyncio.run(
        _create_invite(
            phone_number=args.phone,
            note=args.note,
            expires_days=args.expires_days,
        )
    )
    url = f"{args.base_url.rstrip('/')}/invite/{invite.token}"
    print("Приглашение создано.")
    if invite.phone_number:
        print(f"Номер: {invite.phone_number}")
    if invite.note:
        print(f"Заметка: {invite.note}")
    if invite.expires_at:
        print(f"Истекает: {invite.expires_at.isoformat()}")
    print(f"Ссылка (передайте лично): {url}")


if __name__ == "__main__":
    main()
