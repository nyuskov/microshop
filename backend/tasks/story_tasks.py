"""Фоновые задачи историй: удаление просроченных публикаций.

Сама лента истории с истёкшим сроком не показывает (условие ``expires_at >
now()`` в выборке), поэтому удаление — это уборка мусора в БД, а не то, от чего
зависит видимость. Файлы на диске подберёт ночная очистка media: она удаляет
всё, на что нет ссылок в БД (см. ``tasks.media_tasks.cleanup_orphan_media``).
"""

from __future__ import annotations

import logging

from core.celery_app import celery_app
from tasks.base import make_engine, make_session, run_async

logger = logging.getLogger(__name__)


async def _delete_expired() -> int:
    # Импорт внутри функции: воркеру не нужен FastAPI-роутер историй.
    from api_v1.stories import crud

    engine = make_engine()
    session_factory = make_session(engine)
    try:
        async with session_factory() as session:
            removed = await crud.delete_expired(session)
            await session.commit()
            return removed
    finally:
        await engine.dispose()


@celery_app.task(name="tasks.story_tasks.delete_expired_stories")
def delete_expired_stories() -> dict[str, int]:
    """Удаляет истории, срок которых истёк (по умолчанию раз в час)."""
    removed = run_async(_delete_expired())
    if removed:
        logger.info("Удалено просроченных историй: %s", removed)
    return {"removed": removed}
