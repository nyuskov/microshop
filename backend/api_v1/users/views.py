from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import db_helper
from . import crud
from .schemas import CreateUser
from api_v1.auth.validation import get_current_active_admin_user

router = APIRouter(
    prefix="/users",
    tags=["Пользователи"],
)


@router.get(
    "/",
    summary="Получение всех пользователей",
    dependencies=[Depends(get_current_active_admin_user)],  # Добавляем зависимость для проверки администратора
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
    new_user: CreateUser,
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    return await crud.create_user(new_user, session)