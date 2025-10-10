import asyncio
import contextlib

import sys

sys.path.insert(0, "/home/freedom/Документы/education/fastapi/microshop/backend/")

from api_v1.auth.user_manager import UserManager
from api_v1.dependencies.user_manager import get_user_manager
from api_v1.dependencies.users import get_user_db
from core.models import db_helper, User
from core.schemas.user import UserCreate

get_user_db_context = contextlib.asynccontextmanager(get_user_db)
get_user_manager_context = contextlib.asynccontextmanager(get_user_manager)

default_email = "admin@admin.com"
default_username = "admin"
default_password = "qwerty"
default_is_active = True
default_is_superuser = True
default_is_verified = True


async def create_user(
    user_manager: UserManager,
    user_create: UserCreate,
) -> User:
    user = await user_manager.create(
        user_create=user_create,
        safe=False,
    )
    return user


async def create_superuser(
    username: str = default_username,
    email: str = default_email,
    password: str = default_password,
    is_active: bool = default_is_active,
    is_superuser: bool = default_is_superuser,
    is_verified: bool = default_is_verified,
):
    user_create = UserCreate(
        username=username,
        email=email,
        password=password,
        is_active=is_active,
        is_superuser=is_superuser,
        is_verified=is_verified,
    )

    async with db_helper.session_factory() as session:
        async with get_user_db_context(session) as user_db:
            async with get_user_manager_context(user_db) as user_manager:
                return await create_user(
                    user_create=user_create,
                    user_manager=user_manager,
                )


if __name__ == "__main__":
    asyncio.run(create_superuser())
