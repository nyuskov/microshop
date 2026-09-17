"""Фоновая уборка хранилища сигналинга звонков.

Парковка вызова и недоставленные сигнальные сообщения (``pending_call_offers``,
``queued_call_signals``) удаляются при чтении и ленивой чистке, поэтому задача —
лишь страховка: строки для «молчащих» абонентов (никто не переподключился) иначе
оставались бы в БД. Жизнь у них короткая (минуты), так что задача лёгкая.
"""

from __future__ import annotations

import logging

from core.celery_app import celery_app
from tasks.base import run_async

logger = logging.getLogger(__name__)


async def _prune() -> None:
    # Импорт внутри функции: воркеру не нужны роутеры звонков и FastAPI.
    from api_v1.calls import store

    await store.prune_expired_signals()


@celery_app.task(name="tasks.call_tasks.prune_call_signals")
def prune_call_signals() -> dict[str, bool]:
    """Убирает просроченные парковки и сигнальные сообщения (раз в 5 минут)."""
    run_async(_prune())
    return {"ok": True}
