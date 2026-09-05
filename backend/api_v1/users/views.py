"""Эндпоинты для управления пользователями."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.users import crud, schemas
from core.models import User, db_helper
from core.security import get_password_hash

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("/", response_model=list[schemas.UserWithDetailsSchema])
async def get_users(
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[User]:
    return await crud.get_users_with_profile(session)


@router.get("/{user_id}/", response_model=schemas.UserWithDetailsSchema)
async def get_user(
    user_id: int,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> User:
    user = await crud.get_user_with_profile(session, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    return user


@router.post(
    "/",
    response_model=schemas.UserCreatedResponseSchema,
    status_code=status.HTTP_201_CREATED,
)
async def create_user(
    user_in: schemas.CreateUser,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> User:
    user = User(**user_in.model_dump(exclude={"password"}))
    user.hashed_password = get_password_hash(user_in.password)
    return await crud.create_user(session, user)


@router.get("/{user_id}/chats/", response_model=list[schemas.ChatSchema])
async def get_chats_for_user(
    user_id: int,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list:
    user = await crud.get_user_with_chats(session, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    return user.chats


@router.get("/{user_id}/posts/", response_model=list[schemas.PostSchema])
async def get_posts_for_user(
    user_id: int,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list:
    return await crud.get_posts_for_user(session, user_id)
