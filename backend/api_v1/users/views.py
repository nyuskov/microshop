from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.users import crud, schemas
from core.models import User, db_helper

router = APIRouter(
    prefix="/users",
    tags=["Users"],
)


@router.get(
    "/", response_model=list[schemas.UserWithDetailsSchema]
)  # Используем новую схему
async def get_users(
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    users = await crud.get_users_with_profile(session=session)
    return users


@router.get(
    "/{user_id}/", response_model=schemas.UserWithDetailsSchema
)  # Используем новую схему
async def get_user(
    user_id: int,
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    user = await crud.get_user_with_profile(session=session, user_id=user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post(
    "/", response_model=schemas.UserCreatedResponseSchema
)  # Используем новую схему
async def create_user(
    user_in: schemas.CreateUser,  # Используем новую схему
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    user = User(**user_in.model_dump(exclude={"password"}))
    user.set_password(user_in.password)  # Устанавливаем пароль через метод модели
    created_user = await crud.create_user(session=session, user=user)
    return {"id": created_user.id, "username": created_user.username}


@router.get(
    "/{user_id}/groups/", response_model=list[schemas.GroupSchema]
)  # Используем новую схему
async def get_groups_for_user(
    user_id: int,
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    user = await crud.get_user_with_groups(session=session, user_id=user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return [schemas.GroupSchema.from_orm(group) for group in user.groups]


@router.get(
    "/{user_id}/posts/", response_model=list[schemas.PostSchema]
)  # Используем новую схему
async def get_posts_for_user(
    user_id: int,
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    user = await crud.get_user_with_posts(session=session, user_id=user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return [schemas.PostSchema.from_orm(post) for post in user.posts]
