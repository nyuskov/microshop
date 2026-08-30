from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from core import crud
from core.models import Post, db_helper, User
from .schemas import PostCreate, PostUpdate, PostBase

router = APIRouter(tags=["Posts"])


@router.post("/", response_model=PostBase)
async def create_post(
    post_in: PostCreate,
    user: User = Depends(crud.get_current_user),  # Предполагаем, что есть зависимость для аутентификации
    session: AsyncSession = Depends(db_helper.session_getter),
):
    """Создать новый пост от имени текущего пользователя."""
    db_post = await crud.create_post(
        session=session, user_id=user.id, title=post_in.title, body=post_in.body
    )
    return db_post


@router.get("/{post_id}/", response_model=PostBase)
async def get_post(
    post_id: int,
    session: AsyncSession = Depends(db_helper.session_getter),
):
    """Получить пост по ID."""
    db_post = await crud.get_post_by_id(session=session, post_id=post_id)
    if not db_post:
        raise HTTPException(status_code=404, detail="Post not found")
    return db_post


@router.patch("/{post_id}/", response_model=PostBase)
async def update_post(
    post_id: int,
    post_update: PostUpdate,
    user: User = Depends(crud.get_current_user),  # Только владелец может обновить
    session: AsyncSession = Depends(db_helper.session_getter),
):
    """Обновить существующий пост (только если пользователь является владельцем)."""
    db_post = await crud.get_post_by_id(session=session, post_id=post_id)
    if not db_post:
        raise HTTPException(status_code=404, detail="Post not found")
    if db_post.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized to update this post")

    updated_post = await crud.update_post(
        session=session, post=db_post, title=post_update.title, body=post_update.body
    )
    return updated_post


@router.delete("/{post_id}/", status_code=204)
async def delete_post(
    post_id: int,
    user: User = Depends(crud.get_current_user),  # Только владелец может удалить
    session: AsyncSession = Depends(db_helper.session_getter),
):
    """Удалить пост (только если пользователь является владельцем)."""
    db_post = await crud.get_post_by_id(session=session, post_id=post_id)
    if not db_post:
        raise HTTPException(status_code=404, detail="Post not found")
    if db_post.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this post")

    await crud.delete_post(session=session, post=db_post)
    return  # 204 No Content


# Роут для получения постов конкретного пользователя
@router.get("/by_user/{user_id}/", response_model=list[PostBase])
async def get_posts_for_user(
    user_id: int,
    session: AsyncSession = Depends(db_helper.session_getter),
):
    """Получить все посты пользователя по его ID."""
    posts = await crud.get_posts_by_user_id(session=session, user_id=user_id)
    return posts