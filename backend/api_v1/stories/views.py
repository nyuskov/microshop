"""API историй: лента, публикация, просмотр, удаление."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_user
from api_v1.media_quota import enforce_media_quota
from api_v1.media_store import store_media
from api_v1.upload_guard import (
    SAFE_IMAGE_EXTS,
    SAFE_MEDIA_EXTS,
    normalize_ext,
    validate_attachment_upload,
)
from core.config import settings
from core.models import User, db_helper

from . import crud
from .schemas import StoryFeed, StoryGroup, StoryItem

router = APIRouter(prefix="/stories", tags=["Истории"])

MAX_UPLOAD_SIZE = settings.max_upload_size_bytes
MAX_UPLOAD_MB = MAX_UPLOAD_SIZE // (1024 * 1024)
#: Сколько своих историй разрешено держать одновременно (они живут 24 часа).
MAX_ACTIVE_STORIES = 30


@router.get("/", response_model=StoryFeed)
async def get_feed(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> StoryFeed:
    """Лента историй: свои сверху, затем чужие (непросроченные)."""
    groups = await crud.feed(session, viewer_id=user.id)
    return StoryFeed(groups=groups)


@router.post("/", response_model=StoryItem, status_code=status.HTTP_201_CREATED)
async def create_story(
    request: Request,
    filename: str = Query("story.jpg", max_length=255),
    mime: str = Query("image/jpeg", max_length=120),
    caption: str = Query("", max_length=255),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> StoryItem:
    """Публикует историю: медиа приходит телом запроса, остальное — в параметрах.

    Файл кладётся в общий каталог media, а в квоте хранилища учитывается так же,
    как вложения сообщений (``api_v1/media_quota.py``).
    """
    content = await request.body()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пустой файл",
        )
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Файл слишком большой (максимум {MAX_UPLOAD_MB} МБ)",
        )
    validate_attachment_upload(filename, content)
    # История — это фото или видео. Документ/аудио в ленте выглядели бы как
    # пустой экран, поэтому отсекаем сразу (вложения в чат остаются любыми).
    if normalize_ext(filename) not in (SAFE_IMAGE_EXTS | SAFE_MEDIA_EXTS):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="История может быть фото или видео",
        )
    await enforce_media_quota(session, user_id=user.id, incoming_bytes=len(content))

    active = await crud.count_active(session, user_id=user.id)
    if active >= MAX_ACTIVE_STORIES:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Слишком много активных историй — дождитесь, пока истекут прежние "
                f"(до {settings.story_ttl_hours} часов)"
            ),
        )

    story = await crud.create_story(
        session,
        user_id=user.id,
        media_url=store_media(content, suffix=_suffix_of(filename)),
        media_name=filename,
        mime_type=mime,
        media_size=len(content),
        caption=caption.strip()[:255] or None,
    )
    await session.commit()
    return StoryItem(
        id=story.id,
        media_url=story.media_url,
        media_name=story.media_name,
        mime_type=story.mime_type,
        caption=story.caption,
        created_at=story.created_at,
        expires_at=story.expires_at,
        viewed=False,
        views=0,
    )


@router.post("/{story_id}/view/", response_model=StoryGroup | None)
async def view_story(
    story_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> StoryGroup | None:
    """Отмечает историю просмотренной и возвращает обновлённую группу автора."""
    story = await crud.get_story(session, story_id)
    if story is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="История не найдена"
        )
    if story.user_id != user.id:
        await crud.mark_viewed(session, story_id=story_id, viewer_id=user.id)
        await session.commit()
    groups = await crud.feed(session, viewer_id=user.id)
    return next((group for group in groups if group.user.id == story.user_id), None)


@router.delete("/{story_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_story(
    story_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Удаляет свою историю."""
    deleted = await crud.delete_story(session, story_id=story_id, user_id=user.id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="История не найдена или не ваша",
        )
    await session.commit()


def _suffix_of(filename: str) -> str:
    """Расширение файла вместе с точкой (``''``, если его нет)."""
    _, dot, ext = filename.rpartition(".")
    return f".{ext}" if dot and ext else ""
