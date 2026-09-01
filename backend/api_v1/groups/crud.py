from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.models import Group


async def get_all_groups(session: AsyncSession) -> list[Group]:
    """Получить список всех групп."""
    stmt = select(Group).options(selectinload(Group.users))
    result = await session.scalars(stmt)
    return list(result.all())


async def get_group_by_id(session: AsyncSession, group_id: int) -> Group | None:
    """Получить группу по ID."""
    stmt = select(Group).where(Group.id == group_id).options(selectinload(Group.users))
    result = await session.scalars(stmt)
    return result.first()


async def create_group(session: AsyncSession, group_data: dict) -> Group:
    """Создать новую группу."""
    group = Group(**group_data)
    session.add(group)
    await session.commit()
    await session.refresh(group)
    return group


async def update_group(session: AsyncSession, group: Group, update_data: dict) -> Group:
    """Обновить существующую группу."""
    for key, value in update_data.items():
        setattr(group, key, value)
    await session.commit()
    await session.refresh(group)
    return group


async def delete_group(session: AsyncSession, group: Group) -> None:
    """Удалить группу."""
    await session.delete(group)
    await session.commit()