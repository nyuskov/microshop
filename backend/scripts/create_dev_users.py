"""Разовое создание тестовых пользователей в DEV (не в проде!).

Зачем: для проверки группового звонка нужно 3–4 живых аккаунта. Скриптов
регистрации в проекте нет (закрытая регистрация по инвайтам), поэтому заводим
аккаунты напрямую через модели — с известным паролем, подтверждённым телефоном и
человеческим именем, чтобы в интерфейсе было понятно, кто есть кто.

Запуск (внутри контейнера web, dev-база)::

    docker exec -i microshop-web-1 sh -lc "cd /app && poetry run python -" \
        < create_dev_users.py

Всё идемпотентно: существующие номера не трогаем, группу не дублируем.
"""

import asyncio
from typing import Final

from sqlalchemy import select

from api_v1.chats.crud import create_group_chat
from core.models import Profile, User, db_helper
from core.security import get_password_hash

#: Пароль всех тестовых аккаунтов (совпадает с основным тестовым).
PASSWORD: Final[str] = "Testpass123"

#: (телефон, имя) — имена видно в списке чатов и в плитках звонка.
PEOPLE: Final[tuple[tuple[str, str], ...]] = (
    ("+79001110003", "Ольга"),
    ("+79001110004", "Павел"),
    ("+79001110005", "Сергей"),
)

#: Владелец тестовой группы и остальные её участники (по номерам).
GROUP_TITLE: Final[str] = "Проверка звонка"
GROUP_MEMBERS: Final[tuple[str, ...]] = (
    "+79001110001",
    "+79001110002",
    "+79001110003",
    "+79001110004",
    "+79001110005",
)


async def main() -> None:
    async with db_helper.session_factory() as session:
        created: list[tuple[str, str, int]] = []
        for phone, name in PEOPLE:
            existing = (
                await session.execute(select(User).where(User.phone_number == phone))
            ).scalar_one_or_none()
            if existing is not None:
                print(f"= {name} {phone}: уже есть (id {existing.id})")
                created.append((phone, name, existing.id))
                continue

            # username уникален и непустой: по нему логин внутри проекта.
            user = User(
                username=f"dev_{phone.lstrip('+')}",
                phone_number=phone,
                first_name=name,
                hashed_password=get_password_hash(PASSWORD),
                is_active=True,
                is_verified=True,
                password_set=True,
            )
            session.add(user)
            await session.flush()
            session.add(Profile(user_id=user.id))
            created.append((phone, name, user.id))
            print(f"+ {name} {phone}: создан (id {user.id}, пароль {PASSWORD})")

        await session.flush()

        owner = (
            await session.execute(
                select(User).where(User.phone_number == GROUP_MEMBERS[0])
            )
        ).scalar_one()
        members = (
            (
                await session.execute(
                    select(User).where(User.phone_number.in_(GROUP_MEMBERS[1:]))
                )
            )
            .scalars()
            .all()
        )
        existing_chat = (
            await session.execute(select(User.id).where(User.id == owner.id))
        ).scalar_one()

        # Группу создаём один раз: по названию её и искать.
        from core.models import Chat, user_chat_association_table  # noqa: PLC0415

        chat_id = (
            await session.execute(
                select(user_chat_association_table.c.chat_id)
                .join(Chat, Chat.id == user_chat_association_table.c.chat_id)
                .where(
                    Chat.name == GROUP_TITLE,
                    Chat.is_group.is_(True),
                    user_chat_association_table.c.user_id == owner.id,
                )
                .limit(1)
            )
        ).scalar_one_or_none()

        if chat_id is None:
            chat = await create_group_chat(
                session,
                user_id=owner.id,
                name=GROUP_TITLE,
                user_ids=[user.id for user in members],
            )
            print(f"+ группа «{GROUP_TITLE}» создана (id {chat.id})")
        else:
            print(f"= группа «{GROUP_TITLE}» уже есть (id {chat_id})")

        await session.commit()
        print(f"участник-владелец: id {existing_chat} ({GROUP_MEMBERS[0]})")
        for phone, name, user_id in created:
            print(f"  {name}: {phone} / {PASSWORD} (id {user_id})")


asyncio.run(main())
