from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.models import Group, User


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
    """Создать новую группу и вернуть её с загруженными связями."""
    group = Group(**group_data)
    session.add(group)
    await session.flush() # flush(), чтобы получить ID, но не commit()
    new_id = group.id
    await session.commit()

    # Загружаем созданную группу с users
    stmt = select(Group).where(Group.id == new_id).options(selectinload(Group.users))
    result = await session.scalars(stmt)
    return result.first()


async def update_group(session: AsyncSession, group: Group, update_data: dict) -> Group:
    """Обновить существующую группу."""
    for key, value in update_data.items():
        setattr(group, key, value)
    await session.commit()
    # Необходимо перезагрузить с users, если update не затрагивает users напрямую
    # Но лучше вызвать отдельный CRUD метод для обновления users
    # Здесь просто перезагрузим объект с users
    stmt = select(Group).where(Group.id == group.id).options(selectinload(Group.users))
    result = await session.scalars(stmt)
    return result.first()


async def delete_group(session: AsyncSession, group: Group) -> None:
    """Удалить группу."""
    await session.delete(group)
    await session.commit()


# --- Новые функции для управления пользователями в группе ---

async def get_users_in_group(session: AsyncSession, group_id: int) -> list[User]:
    """Получить список пользователей, принадлежащих к группе."""
    stmt = select(Group).where(Group.id == group_id).options(selectinload(Group.users))
    result = await session.scalars(stmt)
    group = result.first()
    if group:
        return group.users
    return []


async def update_users_in_group(session: AsyncSession, group: Group, user_ids: list[int]) -> Group:
    """Полностью обновить список пользователей в группе."""
    # Получаем объекты User по ID
    user_objects = await session.scalars(select(User).where(User.id.in_(user_ids)))
    new_users_list = list(user_objects.all())

    # Присваиваем новый список пользователей группе
    group.users = new_users_list
    await session.commit()
    # Перезагружаем group с обновленной связью users
    stmt = select(Group).where(Group.id == group.id).options(selectinload(Group.users))
    result = await session.scalars(stmt)
    return result.first()
# --- Конец новых функций ---