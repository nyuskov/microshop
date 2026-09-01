from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import db_helper
from . import crud
from .schemas import CreateUser, PublicUserSchema, UserWithDetailsSchema # Импортируем новую схему
from api_v1.auth.validation import get_current_active_admin_user # Импортируем зависимость
from api_v1.groups.schemas import Group # Импортируем схему Group для возврата

router = APIRouter(
    prefix="/users",
    tags=["Пользователи"],
)


@router.get(
    "/",
    summary="Получение всех пользователей",
    response_model=list[UserWithDetailsSchema], # <-- Указываем новую схему
    dependencies=[Depends(get_current_active_admin_user)],  # Добавляем зависимость для проверки администратора
)
async def get_users(
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    return await crud.get_users_with_posts_and_profiles(session)


@router.get(
    "/{user_id}/groups/",
    summary="Получение групп пользователя",
    response_model=list[Group], # Указываем схему Group для возврата
    dependencies=[Depends(get_current_active_admin_user)],  # Защита
)
async def get_user_groups(
    user_id: int, # Принимаем ID пользователя
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """
    Возвращает список групп, к которым принадлежит пользователь.
    """
    return await crud.get_groups_for_user(session, user_id)


@router.post(
    "/",
    summary="Создание пользователя",
)
async def create_user(
    new_user: CreateUser,
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    return await crud.create_user(new_user, session)