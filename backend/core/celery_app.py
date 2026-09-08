"""Конфигурация Celery (брокер RabbitMQ).

Приложение Celery используется тремя способами:

* ``celery -A core.celery_app worker``  — воркер исполняет фоновые задачи;
* ``celery -A core.celery_app beat``     — планировщик периодических задач
  (сейчас — очистка «осиротевших» файлов в media);
* web-процесс FastAPI импортирует это приложение, чтобы отправлять задачи
  (``get_task(...).delay(...)``) и — отдельно — слушать мост realtime-событий
  воркера (см. ``api_v1/events/bridge.py``).

Задачи определены в пакете ``tasks`` (см. ``include`` ниже). Воркеру не нужен
FastAPI, но нужен доступ к моделям/БД — поэтому здесь импортируются
инфраструктурные модули ``core``, не тянущие FastAPI-приложение.
"""

from datetime import timedelta
from typing import Any

from celery import Celery  # type: ignore[import-untyped]
from celery.schedules import crontab  # type: ignore[import-untyped]
from kombu import Exchange, Queue  # type: ignore[import-untyped]

from core.config import settings

# Приложение Celery с брокером RabbitMQ.
celery_app = Celery(
    "microshop",
    broker=settings.rabbitmq_url,
    # Бэкенд результатов не используется (задачи «fire-and-forget»): сообщаем
    # об ошибках через retry/логи, а не через Celery result store в RabbitMQ.
    backend=None,
    include=[
        "tasks.otp_tasks",
        "tasks.media_tasks",
        "tasks.notifications",
        "tasks.telegram",
    ],
)

# Параметры по умолчанию для всех тасок.
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    # Время, в течение которого задача считается «не принятой» и может быть
    # переотправлена другому воркеру после аварийной остановки.
    task_acks_late=False,
    task_reject_on_worker_lost=True,
    task_default_queue="microshop",
    task_default_exchange="microshop",
    task_default_exchange_type="direct",
    task_default_routing_key="microshop",
    # Явная durable-очередь. RabbitMQ 4.x по умолчанию запрещает «transient
    # non-exclusive» очереди (которые Celery создавал бы без этой настройки).
    task_queues=(
        Queue(
            "microshop",
            Exchange("microshop", type="direct", durable=True),
            routing_key="microshop",
            durable=True,
        ),
    ),
    task_default_delivery_mode=2,  # persistent-сообщения (совпадает с durable)
    # Сколько секунд Celery будет ждать новые задачи, прежде чем «уснуть».
    broker_connection_retry_on_startup=True,
    timezone="UTC",
    enable_utc=True,
    # Отключаем remote-control (pidbox): его reply-очередь — transient
    # non-exclusive, которую RabbitMQ 4.x по умолчанию не разрешает. Для
    # нашего сценария (fire-and-forget, один воркер) remote-control не нужен.
    worker_enable_remote_control=False,
    # Файл состояния celery beat (последние запуски периодических задач).
    # В /tmp — чтобы работало и в контейнере (не-root), и на хосте при
    # локальном запуске; состояние не критично (расписание задано в коде).
    beat_schedule_filename="/tmp/celerybeat-schedule",
)

# Периодические задачи (celery beat). Каждая задача просто объявляется; сам
# обработчик живёт в tasks.<module>.
celery_app.conf.beat_schedule = {
    # Ежедневная очистка файлов media, на которые нет ссылок в БД.
    "cleanup-orphan-media-daily": {
        "task": "tasks.media_tasks.cleanup_orphan_media",
        "schedule": crontab(hour=4, minute=0),
        "options": {"queue": "microshop"},
    },
    # Поллинг обычного Telegram-бота: привязка чатов (/start bind_...) —
    # резервный канал доставки OTP. Работает, только если задан бот-токен.
    "telegram-poll-updates": {
        "task": "tasks.telegram.telegram_poll_updates",
        "schedule": timedelta(seconds=settings.telegram_poll_interval_seconds),
        "options": {"queue": "microshop"},
    },
}


class TaskEnvelope:
    """Типизированная обёртка отложенного запуска задачи по имени.

    Celery не поставляет стабов типов, поэтому вместо ``celery_app.tasks[name]``
    (``object`` без ``.delay``) возвращаем обёртку с узким API.
    """

    def __init__(self, name: str) -> None:
        self._name = name

    def delay(self, *args: Any, **kwargs: Any) -> Any:
        """Ставит задачу в очередь (fire-and-forget)."""
        return celery_app.send_task(self._name, args=args, kwargs=kwargs)


def get_task(name: str) -> TaskEnvelope:
    """Возвращает обёртку задачи Celery по имени.

    Используется в views, чтобы запустить задачу в фоне (``.delay(...)``), не
    импортируя обработчик на горячем пути запроса (спасает от цикличных
    импортов API->tasks).
    """
    return TaskEnvelope(name)


__all__ = ["celery_app", "get_task"]
