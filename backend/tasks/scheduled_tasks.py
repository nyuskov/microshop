"""Фоновая задача отложенных сообщений: разбор очереди «отправить позже».

Зачем сервер, а не таймер в браузере: сообщение должно уйти и с закрытым
приложением. Beat будит задачу раз в минуту (см. ``build_beat_schedule``), она
отправляет всё, чему пришло время, и удаляет записи.

Неудачу не откладываем: если человек вышел из чата или его замутили, повтор
каждую минуту превратился бы в вечный цикл — запись удаляется, причина уходит в
лог (см. ``messages.crud.send_due_scheduled_messages``).

Здесь же разбираются напоминания о сообщениях («напомнить мне»): они устроены
так же — время задаёт человек, поэтому очередь на сервере. Отличие в доставке:
отложенное сообщение уходит в чат, а напоминание — push'ом самому человеку
(``tasks.notifications.send_reminder_push``).
"""

from __future__ import annotations

import logging

from core.celery_app import celery_app, get_task
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


async def _take_due_reminders() -> list[dict[str, int]]:
    """Забирает наступившие напоминания из БД (записи при этом удаляются)."""
    from api_v1.messages import crud

    engine = make_engine()
    session = make_session(engine)
    try:
        return await crud.take_due_message_reminders(session)
    finally:
        await session.close()
        await engine.dispose()


async def _drain_reminders() -> dict[str, int]:
    """Разбирает очередь напоминаний и ставит по каждому push-задачу.

    Саму доставку делает ``tasks.notifications.send_reminder_push`` (там Web Push
    и RuStore). Записи к этому моменту уже удалены: если push не уйдёт (нет
    подписки, нет сети), напоминание пропадёт, а не будет повторяться каждую
    минуту до бесконечности.
    """
    due = await _take_due_reminders()
    queued = 0
    for item in due:
        try:
            get_task("tasks.notifications.send_reminder_push").delay(**item)
            queued += 1
        except Exception:  # очередь (RabbitMQ) может быть недоступна
            logger.warning(
                "Напоминание (id=%s, чат=%s) не поставлено в очередь",
                item.get("reminder_id"),
                item.get("chat_id"),
                exc_info=True,
            )
    return {"due": len(due), "queued": queued}


@celery_app.task(name="tasks.scheduled_tasks.send_due_message_reminders")
def send_due_message_reminders() -> dict[str, int]:
    """Ставит в очередь push о наступивших напоминаниях о сообщениях."""
    result = run_async(_drain_reminders())
    if result["queued"]:
        logger.info(
            "Напоминания о сообщениях: поставлено push-задач %s", result["queued"]
        )
    return result
