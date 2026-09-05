"""CRUD-операции для постов."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Post


async def get_all_posts(session: AsyncSession) -> list[Post]:
    """Возвращает все посты."""
    result = await session.execute(select(Post).order_by(Post.id))
    return list(result.scalars().all())


async def get_post_by_id(session: AsyncSession, post_id: int) -> Post | None:
    """Возвращает пост по id."""
    return await session.get(Post, post_id)


async def get_posts_by_user_id(session: AsyncSession, user_id: int) -> list[Post]:
    """Возвращает посты пользователя."""
    result = await session.execute(
        select(Post).where(Post.user_id == user_id).order_by(Post.id)
    )
    return list(result.scalars().all())


async def create_post(
    session: AsyncSession,
    user_id: int,
    title: str,
    body: str,
) -> Post:
    """Создаёт пост."""
    post = Post(user_id=user_id, title=title, body=body)
    session.add(post)
    await session.commit()
    await session.refresh(post)
    return post


async def update_post(
    session: AsyncSession,
    post: Post,
    title: str | None = None,
    body: str | None = None,
) -> Post:
    """Обновляет пост."""
    if title is not None:
        post.title = title
    if body is not None:
        post.body = body
    await session.commit()
    await session.refresh(post)
    return post


async def delete_post(session: AsyncSession, post: Post) -> None:
    """Удаляет пост."""
    await session.delete(post)
    await session.commit()
