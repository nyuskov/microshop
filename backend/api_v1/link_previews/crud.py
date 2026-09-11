"""Доступ к кэшу карточек ссылок."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.link_preview import LinkPreviewData
from core.models import LinkPreview

MEDIA_DIR = Path(__file__).resolve().parent.parent.parent / "media"


def is_expired(row: LinkPreview, *, now: datetime | None = None) -> bool:
    """Пора ли обновлять карточку (у неудачных срок короче — час)."""
    moment = now or datetime.now(timezone.utc)
    fetched_at = row.fetched_at
    if fetched_at.tzinfo is None:
        # SQLite/старые данные без зоны: считаем, что время в UTC.
        fetched_at = fetched_at.replace(tzinfo=timezone.utc)
    if row.ok:
        ttl = timedelta(hours=settings.link_preview_cache_hours)
    else:
        ttl = timedelta(minutes=settings.link_preview_failure_cache_minutes)
    return moment - fetched_at > ttl


async def get_cached(session: AsyncSession, url: str) -> LinkPreview | None:
    """Карточка из кэша по адресу (``None`` — ещё не запрашивали)."""
    result = await session.execute(select(LinkPreview).where(LinkPreview.url == url))
    return result.scalar_one_or_none()


async def save(
    session: AsyncSession,
    *,
    url: str,
    data: LinkPreviewData | None,
    image_url: str | None,
) -> LinkPreview:
    """Сохраняет/обновляет карточку. ``data=None`` — неудачное обращение."""
    row = await get_cached(session, url)
    now = datetime.now(timezone.utc)
    if row is None:
        row = LinkPreview(url=url)
        session.add(row)
    elif row.image_url and row.image_url != image_url:
        # Прежняя картинка больше не нужна — иначе файлы копились бы на диске.
        _drop_file(row.image_url)

    row.ok = data is not None
    row.title = data.title if data else None
    row.description = data.description if data else None
    row.site_name = data.site_name if data else None
    row.image_url = image_url
    row.fetched_at = now
    try:
        await session.commit()
    except IntegrityError:
        # Две одновременные просьбы об одном адресе: одна вставила строку,
        # вторая получила нарушение уникальности — просто перечитываем её.
        await session.rollback()
        existing = await get_cached(session, url)
        if existing is not None:
            return existing
        raise
    return row


def _drop_file(url: str | None) -> None:
    """Удаляет прежнюю картинку превью (best-effort)."""
    if not url or not url.startswith("/media/"):
        return
    try:
        (MEDIA_DIR / Path(url).name).unlink(missing_ok=True)
    except OSError:
        pass
