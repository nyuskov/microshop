"""Фоновая задача отложенных сообщений: разбор очереди «отправить позже».

Зачем сервер, а не таймер в браузере: сообщение должно уйти и с закрытым
приложением. Beat будит задачу раз в минуту (см. ``build_beat_schedule``), она
отправляет всё, чему пришло время, и удаляет записи.

Неудачу не откладываем: если человек вышел из чата или его замутили, повтор
каждую минуту превратился бы в вечный цикл — запись удаляется, причина уходит в
лог (см. ``messages.crud.send_due_scheduled_messages``).
"""

from __future__ import annotations

import logging

from core.celery_app import celery_app
from tasks.base import make_engine, make_session, run_async

logger = logging.getLogger(__name__)


async def _send_due() -> dict[str, int]:
    # Импорт внутри функции: воркеру не нужен FastAPI-роутер сообщений.
    from api_v1.messages import crud

    engine = make_engine()
    session = make_session(engine)
    try:
        return await crud.send_due_scheduled_messages(session)
    finally:
        await session.close()
        await engine.dispose()


@celery_app.task(name="tasks.scheduled_tasks.send_due_scheduled_messages")
def send_due_scheduled_messages() -> dict[str, int]:
    """Отправляет отложенные сообщения, чьё время пришло."""
    result = run_async(_send_due())
    if result["sent"] or result["dropped"]:
        logger.info(
            "Отложенные сообщения: отправлено %s, отброшено %s",
            result["sent"],
            result["dropped"],
        )
    return result
