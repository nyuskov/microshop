"""Работа с историями: публикация, лента, просмотры, удаление."""

from __future__ import annotations

from collections import OrderedDict
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.models import Story, StoryView, User, UserBlock

from .schemas import StoryAuthor, StoryGroup, StoryItem


def story_expiry(now: datetime | None = None) -> datetime:
    """Когда история перестанет показываться (создание + TTL из настроек)."""
    moment = now or datetime.now(timezone.utc)
    return moment + timedelta(hours=settings.story_ttl_hours)


async def _blocked_ids(session: AsyncSession, user_id: int) -> set[int]:
    """Пользователи, между которыми есть блокировка (в любую сторону)."""
    result = await session.execute(
        select(UserBlock.blocker_id, UserBlock.blocked_id).where(
            or_(UserBlock.blocker_id == user_id, UserBlock.blocked_id == user_id)
        )
    )
    blocked: set[int] = set()
    for blocker_id, blocked_id in result.all():
        blocked.add(blocked_id if blocker_id == user_id else blocker_id)
    return blocked


async def create_story(
    session: AsyncSession,
    *,
    user_id: int,
    media_url: str,
    media_name: str | None,
    mime_type: str | None,
    media_size: int | None,
    caption: str | None = None,
) -> Story:
    """Публикует историю. Свои прошлые истории не удаляем — они доживают срок."""
    story = Story(
        user_id=user_id,
        caption=caption or None,
        media_url=media_url,
        media_name=media_name,
        mime_type=mime_type,
        media_size=media_size,
        expires_at=story_expiry(),
    )
    session.add(story)
    await session.flush()
    await session.refresh(story)
    return story


async def _story_items(
    session: AsyncSession, *, stories: list[Story], viewer_id: int
) -> dict[int, tuple[bool, int]]:
    """Для каждой истории — просмотрел ли её зритель и сколько всего просмотров."""
    if not stories:
        return {}
    story_ids = [story.id for story in stories]

    viewed_rows = await session.execute(
        select(StoryView.story_id)
        .where(StoryView.story_id.in_(story_ids), StoryView.viewer_id == viewer_id)
        .distinct()
    )
    viewed = {row[0] for row in viewed_rows.all()}

    total_rows = await session.execute(
        select(StoryView.story_id, func.count(StoryView.id))
        .where(StoryView.story_id.in_(story_ids))
        .group_by(StoryView.story_id)
    )
    totals = {row[0]: int(row[1]) for row in total_rows.all()}
    return {
        story_id: (story_id in viewed, totals.get(story_id, 0))
        for story_id in story_ids
    }


async def feed(session: AsyncSession, *, viewer_id: int) -> list[StoryGroup]:
    """Лента историй: сначала свои, затем чужие (свежие — выше).

    Показываем только непросроченные истории и только тех, с кем нет блокировки.
    """
    now = datetime.now(timezone.utc)
    blocked = await _blocked_ids(session, viewer_id)

    query = (
        select(Story, User)
        .join(User, User.id == Story.user_id)
        .where(Story.expires_at > now)
        .order_by(Story.created_at.desc())
    )
    if blocked:
        query = query.where(Story.user_id.notin_(blocked))

    result = await session.execute(query)
    rows = result.all()
    if not rows:
        return []

    stories = [story for story, _user in rows]
    state = await _story_items(session, stories=stories, viewer_id=viewer_id)

    # Группируем по автору, сохраняя порядок «сначала мои, потом по свежести».
    grouped: OrderedDict[int, dict] = OrderedDict()
    for story, author in rows:
        bucket = grouped.setdefault(
            author.id,
            {
                "user": author,
                "items": [],
                "has_unseen": False,
                "is_mine": author.id == viewer_id,
            },
        )
        viewed, views = state.get(story.id, (False, 0))
        bucket["items"].append(
            StoryItem(
                id=story.id,
                media_url=story.media_url,
                media_name=story.media_name,
                mime_type=story.mime_type,
                caption=story.caption,
                created_at=story.created_at,
                expires_at=story.expires_at,
                viewed=viewed,
                views=views,
            )
        )
        if not viewed and author.id != viewer_id:
            bucket["has_unseen"] = True

    def sort_key(item: tuple[int, dict]) -> tuple[int, float]:
        author_id, bucket = item
        latest = max(story.created_at.timestamp() for story in bucket["items"])
        # 0 — мои истории (первыми), 1 — остальные.
        return (0 if author_id == viewer_id else 1, -latest)

    groups: list[StoryGroup] = []
    for _author_id, bucket in sorted(grouped.items(), key=sort_key):
        author_row: User = bucket["user"]
        groups.append(
            StoryGroup(
                user=StoryAuthor(
                    id=author_row.id,
                    username=author_row.username,
                    first_name=author_row.first_name,
                    last_name=author_row.last_name,
                    avatar_url=author_row.avatar_url,
                ),
                items=bucket["items"],
                has_unseen=bucket["has_unseen"],
                is_mine=bucket["is_mine"],
            )
        )
    return groups


async def mark_viewed(session: AsyncSession, *, story_id: int, viewer_id: int) -> bool:
    """Отмечает историю просмотренной (повторный вызов ничего не меняет)."""
    exists = await session.scalar(
        select(func.count(StoryView.id)).where(
            StoryView.story_id == story_id, StoryView.viewer_id == viewer_id
        )
    )
    if exists:
        return False
    session.add(StoryView(story_id=story_id, viewer_id=viewer_id))
    await session.flush()
    return True


async def count_active(session: AsyncSession, *, user_id: int) -> int:
    """Сколько непросроченных историй у пользователя (лимит на публикации)."""
    now = datetime.now(timezone.utc)
    total = await session.scalar(
        select(func.count(Story.id)).where(
            Story.user_id == user_id, Story.expires_at > now
        )
    )
    return int(total or 0)


async def get_story(session: AsyncSession, story_id: int) -> Story | None:
    """История по id (для проверки прав при просмотре/удалении)."""
    return await session.scalar(select(Story).where(Story.id == story_id))


async def delete_story(session: AsyncSession, *, story_id: int, user_id: int) -> bool:
    """Удаляет свою историю. Чужую удалить нельзя."""
    story = await get_story(session, story_id)
    if story is None or story.user_id != user_id:
        return False
    await session.delete(story)
    await session.flush()
    return True


async def delete_expired(session: AsyncSession, *, now: datetime | None = None) -> int:
    """Удаляет просроченные истории; возвращает число удалённых."""
    moment = now or datetime.now(timezone.utc)
    result = await session.execute(delete(Story).where(Story.expires_at <= moment))
    return int(result.rowcount or 0)
