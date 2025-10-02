from typing import Annotated
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import db_helper
from users import crud
from users.schemas import User

router = APIRouter(
    prefix="/users",
    tags=["Пользователи"],
)


@router.get(
    "/",
    summary="Получение всех пользователей",
)
async def get_users(
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    return await crud.get_users_with_posts_and_profiles(session)


@router.post(
    "/",
    summary="Создание пользователя",
)
async def create_user(
    new_user: User,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict:
    return await crud.create_user(new_user, session)
