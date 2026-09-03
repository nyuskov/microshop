from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import User


async def get_users(session: AsyncSession) -> list[User]:
    """Получает список всех пользователей."""
    stmt = select(User)
    result = await session.execute(stmt)
    return result.scalars().all()


async def get_user_by_username(session: AsyncSession, username: str) -> User | None:
    """Получает пользователя по его имени."""
    stmt = select(User).where(User.username == username)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


# NEW FUNCTION
async def get_user_by_phone_number(
    session: AsyncSession, phone_number: str
) -> User | None:
    """Получает пользователя по его номеру телефона."""
    stmt = select(User).where(User.phone_number == phone_number)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


# END NEW FUNCTION


async def create_user(session: AsyncSession, user: User) -> User:
    """Создает нового пользователя."""
    session.add(user)
    await session.commit()
    await session.refresh(
        user
    )  # Обновляем объект, чтобы получить сгенерированные значения
    return user


async def delete_user(
    session: AsyncSession,
    user: User,
) -> None:
    """Удаляет пользователя."""
    await session.delete(user)
    await session.commit()
