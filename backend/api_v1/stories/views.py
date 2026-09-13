"""API историй: лента, публикация, просмотр, реакции, удаление."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_user
from core.config import settings
from core.media_quota import enforce_media_quota
from core.media_store import store_media
from core.models import User, db_helper
from core.rate_limit import enforce_limit
from core.upload_guard import (
    SAFE_IMAGE_EXTS,
    SAFE_MEDIA_EXTS,
    normalize_ext,
    validate_attachment_upload,
)

from . import crud
from .reactions import (
    STORY_REACTION_KINDS,
    STORY_REACTIONS_PRIMARY,
    is_allowed_reaction,
)
from .schemas import StoryAudience, StoryFeed, StoryGroup, StoryItem, StoryReactionIn

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
    return StoryFeed(
        groups=groups,
        # Набор реакций отдаём вместе с лентой: панель на клиенте рисуется по
        # данным сервера, поэтому списки эмодзи не могут разъехаться.
        reaction_kinds=list(STORY_REACTION_KINDS),
        reactions_primary=STORY_REACTIONS_PRIMARY,
    )


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
    return crud.build_item(story, viewed=False, views=0)


@router.post("/{story_id}/react/", response_model=StoryItem)
async def react_to_story(
    story_id: int,
    payload: StoryReactionIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> StoryItem:
    """Ставит или снимает реакцию на чужую историю.

    Один вызов — одно переключение: повторный тап тем же эмодзи снимает реакцию.
    Состояние всегда возвращает сервер, поэтому клиенту не нужно угадывать
    результат и не нужен отдельный «удалить реакцию».
    """
    if not is_allowed_reaction(payload.emoji):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Такой реакции нет в наборе",
        )

    # Каждый тап — запись в БД: без лимита реакции можно молотить скриптом.
    await enforce_limit(
        scope="stories:react",
        value=str(user.id),
        limit=settings.story_react_limit_per_minute,
        window_seconds=60,
        detail="Слишком много реакций за минуту. Попробуйте позже.",
    )

    story = await crud.get_active_story(session, story_id)
    if story is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="История не найдена"
        )
    if story.user_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="На свою историю реагировать нельзя",
        )

    await crud.toggle_reaction(
        session, story_id=story_id, user_id=user.id, emoji=payload.emoji
    )
    await session.commit()
    # Сессии проекта живут с expire_on_commit=False, поэтому `story` не нужно
    # перечитывать — но состояния (просмотры, реакции) считаем уже после коммита.
    return await crud.story_item(session, story=story, viewer_id=user.id)


@router.post("/{story_id}/view/", response_model=StoryGroup | None)
async def view_story(
    story_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> StoryGroup | None:
    """Отмечает историю просмотренной и возвращает обновлённую группу автора."""
    await enforce_limit(
        scope="stories:view",
        value=str(user.id),
        limit=settings.story_view_limit_per_minute,
        window_seconds=60,
        detail="Слишком много просмотров за минуту. Попробуйте позже.",
    )
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


@router.get("/{story_id}/audience/", response_model=StoryAudience)
async def story_audience(
    story_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> StoryAudience:
    """Кто смотрел историю и кто как отреагировал — видит только автор.

    Список просмотревших — персональные данные зрителей, поэтому чужой истории
    аудиторию не отдаём (403), а несуществующей/удалённой — 404.
    """
    story = await crud.get_story(session, story_id)
    if story is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="История не найдена"
        )
    if story.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Аудитория видна только автору истории",
        )
    return await crud.audience(session, story=story)


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
