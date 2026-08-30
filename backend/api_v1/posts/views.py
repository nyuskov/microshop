from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from crud import create_post, get_post_by_id, update_post, delete_post, get_posts_by_user_id
from api_v1.auth.utils import get_current_user
from core.models import Post, db_helper, User
from .schemas import PostCreate, PostUpdate, PostBase

router = APIRouter(tags=["Posts"])


@router.post("/", response_model=PostBase)
async def create_post_endpoint(
    post_in: PostCreate,
    user: User = Depends(get_current_user),  # Предполагаем, что есть зависимость для аутентификации
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Создать новый пост от имени текущего пользователя."""
    db_post = await create_post(
        session=session, user_id=user.id, title=post_in.title, body=post_in.body
    )
    return db_post


@router.get("/{post_id}/", response_model=PostBase)
async def get_post_endpoint(
    post_id: int,
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Получить пост по ID."""
    db_post = await get_post_by_id(session=session, post_id=post_id)
    if not db_post:
        raise HTTPException(status_code=404, detail="Post not found")
    return db_post


@router.patch("/{post_id}/", response_model=PostBase)
async def update_post_endpoint(
    post_id: int,
    post_update: PostUpdate,
    user: User = Depends(get_current_user),  # Только владелец может обновить
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Обновить существующий пост (только если пользователь является владельцем)."""
    db_post = await get_post_by_id(session=session, post_id=post_id)
    if not db_post:
        raise HTTPException(status_code=404, detail="Post not found")
    if db_post.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized to update this post")

    updated_post = await update_post(
        session=session, post=db_post, title=post_update.title, body=post_update.body
    )
    return updated_post


@router.delete("/{post_id}/", status_code=204)
async def delete_post_endpoint(
    post_id: int,
    user: User = Depends(get_current_user),  # Только владелец может удалить
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Удалить пост (только если пользователь является владельцем)."""
    db_post = await get_post_by_id(session=session, post_id=post_id)
    if not db_post:
        raise HTTPException(status_code=404, detail="Post not found")
    if db_post.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this post")

    await delete_post(session=session, post=db_post)
    return  # 204 No Content


# Роут для получения постов конкретного пользователя
@router.get("/by_user/{user_id}/", response_model=list[PostBase])
async def get_posts_for_user_endpoint(
    user_id: int,
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Получить все посты пользователя по его ID."""
    posts = await get_posts_by_user_id(session=session, user_id=user_id)
    return posts