from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import secrets
from uuid import uuid4

from core.models import User
from core.security import password_hasher


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

# NEW FUNCTION
async def get_user_by_id(
    session: AsyncSession, user_id: int
) -> User | None:
    """Получает пользователя по его ID."""
    stmt = select(User).where(User.id == user_id)
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


async def get_or_create_user_by_phone_number(
    session: AsyncSession, phone_number: str
) -> User:
    """
    Получает пользователя по номеру телефона. Если не найден, создает нового.
    """
    user = await get_user_by_phone_number(session, phone_number)
    if user:
        return user

    # Генерируем уникальный username и временный пароль
    # username = phone_number.replace("+", "plus_").replace("-", "_") # Простая замена символов
    username = f"phone_{uuid4().hex[:8]}" # Генерация уникального имени
    temp_password = secrets.token_urlsafe(32) # Генерация безопасного пароля
    hashed_temp_password = password_hasher.hash(temp_password)

    # Создаем нового пользователя
    # Устанавливаем значения по умолчанию для полей, обязательных в БД
    new_user = User(
        username=username,
        phone_number=phone_number,
        hashed_password=hashed_temp_password,
        is_active=True, # Предполагаем, что пользователь активен после верификации OTP
        is_verified=True, # Можно отметить как верифицированного по телефону
        # Установим значения по умолчанию для опциональных полей
        email=None, # Теперь email может быть None
        first_name=None,
        last_name=None,
    )

    # Сохраняем в БД
    created_user = await create_user(session, new_user)
    return created_user