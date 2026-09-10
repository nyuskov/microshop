"""Периодические задачи журнала безопасности.

Журнал ``security_events`` растёт от каждого входа и запроса кода, поэтому старые
записи нужно подчищать: иначе таблица за пару лет станет тяжелее самой переписки.
Храним ``audit.RETENTION_DAYS`` дней (180) — с запасом больше срока жизни
refresh-токена, чтобы разобрать инцидент можно было и через месяц.
"""

import logging

from core.celery_app import celery_app
from tasks.base import make_engine, make_session, run_async

logger = logging.getLogger(__name__)


@celery_app.task(name="tasks.security_tasks.prune_security_events")
def prune_security_events() -> int:
    """Удаляет события журнала безопасности старше срока хранения."""
    return run_async(_prune())


async def _prune() -> int:
    # Импорт внутри функции: модуль журнала живёт в api_v1 и тянет FastAPI-схемы,
    # воркеру они не нужны на старте.
    from api_v1.auth.audit import RETENTION_DAYS
    from api_v1.auth.audit import prune_security_events as prune

    engine = make_engine()
    session = make_session(engine)
    try:
        removed = await prune(session)
        logger.info(
            "Журнал безопасности: удалено %s записей старше %s дней",
            removed,
            RETENTION_DAYS,
        )
        return removed
    finally:
        await session.close()
        await engine.dispose()
