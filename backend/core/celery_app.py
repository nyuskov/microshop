"""Конфигурация Celery (брокер RabbitMQ).

Приложение Celery используется тремя способами:

* ``celery -A core.celery_app worker``  — воркер исполняет фоновые задачи;
* ``celery -A core.celery_app beat``     — планировщик периодических задач
  (очистка «осиротевших» файлов в media, уборка историй и сигналинга; состав
  зависит от настроек — см. ``build_beat_schedule``);
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
from kombu.transport import pyamqp  # type: ignore[import-untyped]

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
        "tasks.story_tasks",
        "tasks.call_tasks",
        "tasks.notifications",
        "tasks.security_tasks",
        "tasks.scheduled_tasks",
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


# Prefetch: просим у брокера НЕ глобальный QoS.
#
# Celery выбирает, какой QoS просить, по признаку
# ``kombu.Connection.qos_semantics_matches_spec``: для RabbitMQ >= 3.3 kombu
# отдаёт False (считает, что «старая» семантика из спеки не действует), и тогда
# Celery выставляет ``a_global=True`` — «prefetch на весь канал». В RabbitMQ 4.x
# глобальный QoS объявлен deprecated и по умолчанию НЕ разрешён: на каждом
# подключении воркера брокер пишет в лог
# ``Deprecated features: `global_qos`: ... By default, this feature is not
# permitted anymore`` (уровень error), а сама фича «будет удалена в будущей
# мажорной версии независимо от конфигурации» — то есть готовиться надо уже
# сейчас, а не разрешать её через ``deprecated_features.permit.global_qos``.
#
# Возвращаем True — Celery просит per-consumer prefetch (a_global=False), как
# и рекомендует RabbitMQ (docs/consumer-prefetch). Для нас это то же самое
# поведение: очередь одна, консьюмер в воркере один, prefetch = 4 × concurrency
# (80 при 20 процессах) — ровно столько же, сколько давал глобальный режим.
#
# Убрать шим можно, когда kombu сам перестанет считать семантику «несовпадающей»
# (сейчас 5.6.2 — считает: docs «removal of global QoS» в анонсах RabbitMQ 4.0).
def _qos_semantics_match_spec(self: Any, connection: Any) -> bool:
    """Признак «семантика QoS совпадает со спекой» — всегда True (см. выше)."""
    return True


setattr(pyamqp.Transport, "qos_semantics_matches_spec", _qos_semantics_match_spec)


# Периодические задачи (celery beat). Каждая задача просто объявляется; сам
# обработчик живёт в tasks.<module>.
#
# Собираем расписание функцией, а не литералом: часть задач имеет смысл только
# при определённой настройке, и «висеть» в расписании впустую они не должны —
# beat всё равно шлёт тик, и в логе воркера каждые несколько секунд появляется
# бесполезная строка «succeeded in 0.0001s: None» (см. TELEGRAM_POLL_ENABLED).
def build_beat_schedule(config: Any) -> dict[str, dict[str, Any]]:
    """Расписание периодических задач для настроек ``config``."""
    schedule: dict[str, dict[str, Any]] = {
        # Ежедневная очистка файлов media, на которые нет ссылок в БД.
        "cleanup-orphan-media-daily": {
            "task": "tasks.media_tasks.cleanup_orphan_media",
            "schedule": crontab(hour=4, minute=0),
            "options": {"queue": "microshop"},
        },
        # Уборка просроченных историй (24 часа): раз в час, чтобы в БД не копилось.
        "delete-expired-stories-hourly": {
            "task": "tasks.story_tasks.delete_expired_stories",
            "schedule": crontab(minute=7),
            "options": {"queue": "microshop"},
        },
        # Парковка вызова и недоставленный сигналинг живут минуты и удаляются при
        # чтении; задача — страховка для строк «молчащих» абонентов.
        "prune-call-signals": {
            "task": "tasks.call_tasks.prune_call_signals",
            "schedule": crontab(minute="*/5"),
            "options": {"queue": "microshop"},
        },
        # Отложенные сообщения: раз в минуту, потому что время в них задаёт
        # пользователь («отправь в 9:00»), и опоздание на минуту заметно.
        "send-due-scheduled-messages": {
            "task": "tasks.scheduled_tasks.send_due_scheduled_messages",
            "schedule": crontab(minute="*"),
            "options": {"queue": "microshop"},
        },
        # Напоминания о сообщениях («напомнить мне»): та же причина — время
        # выбирает человек, опоздание на минуту заметно.
        "send-due-message-reminders": {
            "task": "tasks.scheduled_tasks.send_due_message_reminders",
            "schedule": crontab(minute="*"),
            "options": {"queue": "microshop"},
        },
        # Еженедельная чистка журнала безопасности (записи старше 180 дней).
        "prune-security-events-weekly": {
            "task": "tasks.security_tasks.prune_security_events",
            "schedule": crontab(day_of_week="sun", hour=4, minute=30),
            "options": {"queue": "microshop"},
        },
    }
    # Поллинг обычного Telegram-бота: привязка чатов (/start bind_...) —
    # резервный канал доставки OTP. Нужен только если бот настроен и опрос
    # вообще разрешён: без маршрута до api.telegram.org задача ничего не
    # получает (см. `telegram_poll_enabled` в core/config.py).
    if config.telegram_poll_enabled and config.telegram_bot_token:
        schedule["telegram-poll-updates"] = {
            "task": "tasks.telegram.telegram_poll_updates",
            "schedule": timedelta(seconds=config.telegram_poll_interval_seconds),
            "options": {"queue": "microshop"},
        }
    return schedule


celery_app.conf.beat_schedule = build_beat_schedule(settings)


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
