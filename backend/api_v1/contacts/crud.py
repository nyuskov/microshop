"""CRUD контактов («записная книжка» пользователя)."""

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Contact, User


async def list_contacts(
    session: AsyncSession, *, owner_id: int
) -> list[tuple[Contact, User]]:
    """Мои контакты вместе с данными самих пользователей."""
    stmt = (
        select(Contact, User)
        .join(User, User.id == Contact.contact_user_id)
        .where(Contact.owner_id == owner_id)
    )
    rows = (await session.execute(stmt)).all()
    return [(contact, user) for contact, user in rows]


async def upsert_contact(
    session: AsyncSession,
    *,
    owner_id: int,
    contact_user_id: int,
    custom_name: str | None,
) -> Contact:
    """Добавляет человека в контакты или меняет его псевдоним."""
    row = await session.get(
        Contact, {"owner_id": owner_id, "contact_user_id": contact_user_id}
    )
    if row is None:
        row = Contact(
            owner_id=owner_id,
            contact_user_id=contact_user_id,
            custom_name=custom_name,
        )
        session.add(row)
    else:
        row.custom_name = custom_name
    await session.commit()
    return row


async def delete_contact(
    session: AsyncSession, *, owner_id: int, contact_user_id: int
) -> None:
    """Убирает человека из контактов (переписка при этом остаётся)."""
    await session.execute(
        delete(Contact).where(
            Contact.owner_id == owner_id,
            Contact.contact_user_id == contact_user_id,
        )
    )
    await session.commit()


async def contact_names_for(
    session: AsyncSession, *, owner_ids: list[int], peer_id: int
) -> dict[int, str]:
    """Псевдонимы, под которыми ``peer_id`` записан у этих владельцев.

    Нужно для уведомлений: в push пишем то имя, которое человек видит в
    приложении («Мама»), а не формальный логин.
    """
    if not owner_ids:
        return {}
    stmt = select(Contact.owner_id, Contact.custom_name).where(
        Contact.owner_id.in_(owner_ids),
        Contact.contact_user_id == peer_id,
        Contact.custom_name.is_not(None),
    )
    rows = (await session.execute(stmt)).all()
    return {owner_id: name for owner_id, name in rows if name}
