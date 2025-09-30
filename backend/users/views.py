from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import db_helper
from core.models.user import User
from users import crud
from users.schemas import CreateUser

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
async def create_user(new_user: CreateUser):
    return crud.create_user(new_user=new_user)
