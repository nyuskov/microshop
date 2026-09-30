"""API историй: лента, публикация, просмотр, реакции, удаление."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_user
from core.config import settings
from core.i18n import t
from core.image_convert import heic_to_jpeg, jpeg_name, looks_like_heic
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
from core.video_transcode import prepare_video

from . import crud
from .notify import notify_reaction
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
    transcode: bool = Query(False),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> StoryItem:
    """Публикует историю: медиа приходит телом запроса, остальное — в параметрах.

    Файл кладётся в общий каталог media, а в квоте хранилища учитывается так же,
    как вложения сообщений (``core/media_quota.py``).

    ``transcode=1`` — клиент сам попробовал проиграть файл и убедился, что его
    браузер этого не умеет: тогда перекодируем даже формально совместимый формат
    (см. ``core/video_transcode.py``).
    """
    # Перекодирование видео — работа для процессора, причём внутри этого запроса,
    # поэтому частота публикаций ограничена (на аккаунт, как у реакций).
    await enforce_limit(
        scope="stories:publish",
        value=str(user.id),
        limit=settings.story_publish_limit_per_minute,
        window_seconds=60,
        detail=t("Слишком много новых историй за минуту. Попробуйте позже."),
    )
    content = await request.body()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Пустой файл"),
        )
    # HEIC (фото с Samsung/iPhone) перекодируем в JPEG ДО проверки размера:
    # хранить и мерить надо то, что реально ляжет в хранилище, а браузеры HEIC не
    # показывают (`core/image_convert.py`).
    if looks_like_heic(content):
        content = heic_to_jpeg(content)
        filename = jpeg_name(filename)
        mime = "image/jpeg"
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=t("Файл слишком большой (максимум {mb} МБ)", mb=MAX_UPLOAD_MB),
        )
    validate_attachment_upload(filename, content)
    # История — это фото или видео. Документ/аудио в ленте выглядели бы как
    # пустой экран, поэтому отсекаем сразу (вложения в чат остаются любыми).
    ext = normalize_ext(filename)
    if ext not in (SAFE_IMAGE_EXTS | SAFE_MEDIA_EXTS):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=t("История может быть фото или видео"),
        )
    suffix = _suffix_of(filename)
    if ext in SAFE_MEDIA_EXTS:
        # Видео (и аудио, которое историей быть не может) проверяем ДО записи в
        # хранилище: непроигрываемый ролик — это чёрный экран у всех зрителей.
        prepared = await prepare_video(
            content, suffix=suffix, mime=mime, force=transcode
        )
        content = prepared.data
        suffix = prepared.suffix
        mime = prepared.mime
        if len(content) > MAX_UPLOAD_SIZE:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=(
                    "После перекодирования видео получилось больше "
                    f"{MAX_UPLOAD_MB} МБ — выберите файл короче"
                ),
            )
    # Квоту считаем по итоговому файлу: после перекодирования размер меняется.
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
        media_url=store_media(content, suffix=suffix),
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
            detail=t("Такой реакции нет в наборе"),
        )

    # Каждый тап — запись в БД: без лимита реакции можно молотить скриптом.
    await enforce_limit(
        scope="stories:react",
        value=str(user.id),
        limit=settings.story_react_limit_per_minute,
        window_seconds=60,
        detail=t("Слишком много реакций за минуту. Попробуйте позже."),
    )

    story = await crud.get_active_story(session, story_id)
    if story is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=t("История не найдена")
        )
    if story.user_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("На свою историю реагировать нельзя"),
        )

    added = await crud.toggle_reaction(
        session, story_id=story_id, user_id=user.id, emoji=payload.emoji
    )
    await session.commit()
    # Уведомляем автора только о ПОЯВИВШЕЙСЯ реакции: снятие своей — не новость,
    # а push на каждый тап превратил бы панель эмодзи в спам-машину.
    if added:
        await notify_reaction(story=story, reactor=user, emoji=payload.emoji)
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
        detail=t("Слишком много просмотров за минуту. Попробуйте позже."),
    )
    story = await crud.get_story(session, story_id)
    if story is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=t("История не найдена")
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
            status_code=status.HTTP_404_NOT_FOUND, detail=t("История не найдена")
        )
    if story.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=t("Аудитория видна только автору истории"),
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
            detail=t("История не найдена или не ваша"),
        )
    await session.commit()


def _suffix_of(filename: str) -> str:
    """Расширение файла вместе с точкой (``''``, если его нет)."""
    _, dot, ext = filename.rpartition(".")
    return f".{ext}" if dot and ext else ""
