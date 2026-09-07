"""Фоновые задачи: доставка OTP-кода (SMS/e-mail).

Раньше ``send_sms_otp`` вызывался синхронно прямо в теле ``/auth/request-otp/``,
блокируя запрос на время сетевого вызова к SMS-провайдеру. Теперь это — Celery-
задача: эндпоинт лишь кладёт её в очередь RabbitMQ и сразу возвращает ответ, а
сам «тяжёлый» вызов (реальный SMS/email API провайдера в проде) исполняет
воркер в фоне. Это уменьшает латентность эндпоинта и делает отправку
устойчивой к ретраям.
"""

import logging

from core.celery_app import celery_app

logger = logging.getLogger(__name__)

# Время жизни (сек) задачи, за которое воркер должен успеть её обработать,
# прежде чем Celery решит, что она зависла. 5 минут с запасом.
_OTP_TASK_MAX_SECONDS = 300


@celery_app.task(
    name="tasks.otp_tasks.send_sms_otp",
    bind=True,
    max_retries=3,
    default_retry_delay=5,
    soft_time_limit=_OTP_TASK_MAX_SECONDS,
    acks_late=False,
)
def send_sms_otp(self, phone_number: str, otp_code: str) -> None:
    """Отправляет OTP-код пользователю (SMS-заглушка; в проде — API провайдера).

    Пока это заглушка: код печатается в лог воркера, чтобы его можно было
    ввести вручную для входа. При переходе на реального провайдера заменяется
    на сетевой вызов; при сбое сетевого вызова задачу можно переотправить через
    ``self.retry(...)``.
    """
    logger.info("SMS-заглушка: OTP-код для %s -> %s", phone_number, otp_code)
