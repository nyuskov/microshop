"""API предпросмотра внешних ссылок в сообщениях.

Клиент присылает ссылку из сообщения — сервер отдаёт карточку (заголовок,
описание, домен, картинку). Всё кэшируется в БД, поэтому повторные показы одного
и того же адреса не ходят в интернет.

Хождение наружу ограничено по адресам (только публичные IP), времени, размеру и
числу редиректов — см. ``core/link_preview.py``. Чтобы запрос не держал событийный
цикл, сетевые функции вызываются в отдельном потоке.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_user
from core.config import settings
from core.link_preview import fetch_preview, fetch_preview_image, normalize_url
from core.media_store import store_media
from core.models import LinkPreview, User, db_helper
from core.rate_limit import enforce_limit
from core.upload_guard import detect_image_magic

from . import crud
from .schemas import LinkPreviewRequest, LinkPreviewSchema, preview_to_schema

router = APIRouter(prefix="/link-preview", tags=["Предпросмотр ссылок"])


async def _store_image(url: str) -> str | None:
    """Скачивает картинку превью к нам в media; ``None`` — если не вышло.

    Своя копия нужна по двум причинам: часть сайтов запрещает прямые ссылки на
    картинки (превью осталось бы с «битой» картинкой), а IP пользователя не
    должен уходить на каждый сторонний сайт из чужого сообщения.
    """
    result = await asyncio.to_thread(
        fetch_preview_image,
        url,
        timeout=settings.link_preview_timeout_seconds,
        max_bytes=settings.link_preview_image_max_bytes,
        max_redirects=settings.link_preview_max_redirects,
    )
    if result is None:
        return None
    content, _content_type = result
    # Тип определяем по содержимому, а не по заголовку ответа: заголовку верить
    # нельзя, а файл раздаётся с нашего домена.
    extension = detect_image_magic(content)
    if extension is None:
        return None
    return await asyncio.to_thread(store_media, content, f".{extension}")


@router.post("/", response_model=LinkPreviewSchema)
async def create_link_preview(
    payload: LinkPreviewRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> LinkPreviewSchema:
    """Возвращает карточку ссылки (из кэша или скачав страницу)."""
    await enforce_limit(
        scope="links:preview",
        value=str(user.id),
        limit=settings.link_preview_limit_per_minute,
        window_seconds=60,
        detail="Слишком много ссылок за минуту. Попробуйте позже.",
    )
    url = normalize_url(payload.url)
    if url is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ссылку не удалось разобрать",
        )

    cached = await crud.get_cached(session, url)
    if cached is not None and not crud.is_expired(cached):
        return preview_to_schema(cached)

    data = await asyncio.to_thread(
        fetch_preview,
        url,
        timeout=settings.link_preview_timeout_seconds,
        max_bytes=settings.link_preview_max_bytes,
        max_redirects=settings.link_preview_max_redirects,
    )
    image_url = await _store_image(data.image_url) if data and data.image_url else None
    row: LinkPreview = await crud.save(session, url=url, data=data, image_url=image_url)
    return preview_to_schema(row)
