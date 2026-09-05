"""Эндпоинты для работы с постами."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_user
from api_v1.posts import crud
from api_v1.posts.schemas import PostBase, PostCreate, PostUpdate
from core.models import Post, User, db_helper

router = APIRouter(tags=["Posts"])


@router.get("/", response_model=list[PostBase])
async def get_all_posts_endpoint(
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list:
    """Возвращает все посты."""
    return await crud.get_all_posts(session)


@router.get(
    "/by_user/{user_id}/",
    response_model=list[PostBase],
)
async def get_posts_for_user_endpoint(
    user_id: int,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list:
    """Возвращает посты пользователя."""
    return await crud.get_posts_by_user_id(session, user_id)


@router.post(
    "/",
    response_model=PostBase,
    status_code=status.HTTP_201_CREATED,
)
async def create_post_endpoint(
    post_in: PostCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> Post:
    """Создаёт пост от имени текущего пользователя."""
    return await crud.create_post(
        session=session,
        user_id=user.id,
        title=post_in.title,
        body=post_in.body,
    )


@router.get("/{post_id}/", response_model=PostBase)
async def get_post_endpoint(
    post_id: int,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> Post:
    """Возвращает пост по id."""
    post = await crud.get_post_by_id(session, post_id)
    if post is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пост не найден",
        )
    return post


@router.patch("/{post_id}/", response_model=PostBase)
async def update_post_endpoint(
    post_id: int,
    post_update: PostUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> Post:
    """Обновляет пост, если текущий пользователь является его автором."""
    post = await _get_owned_post(session, post_id, user)
    return await crud.update_post(
        session=session,
        post=post,
        title=post_update.title,
        body=post_update.body,
    )


@router.delete("/{post_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post_endpoint(
    post_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> None:
    """Удаляет пост, если текущий пользователь является его автором."""
    post = await _get_owned_post(session, post_id, user)
    await crud.delete_post(session=session, post=post)


async def _get_owned_post(session: AsyncSession, post_id: int, user: User) -> Post:
    """Возвращает пост по id и проверяет право владельца."""
    post = await crud.get_post_by_id(session, post_id)
    if post is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пост не найден",
        )
    if post.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нет прав на выполнение операции",
        )
    return post
