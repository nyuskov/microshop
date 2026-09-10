"""Фоновые задачи: доставка OTP-кода (код в Telegram → SMS → Gateway → лог).

Эндпоинт ``/auth/request-otp/`` лишь кладёт задачу в RabbitMQ (см.
``enqueue_sms_otp`` в auth/views), а реальную доставку выполняет воркер — чтобы
не блокировать HTTP-запрос сетью и иметь возможность ретраить. Каналы по
приоритету (от дешёвого к дорогому, с сохранением надёжности):
  1) «Код в Telegram» через SMS Aero — ≈2,5 ₽ против ≈9 ₽ за SMS; передаём
     текст SMS, поэтому при недоставке в Telegram шлюз сам отправит SMS;
  2) обычное SMS через SMS Aero — если первый вызов упал целиком;
  3) Telegram Gateway — если задан токен (наш сервер, требует egress);
  4) обычный Telegram-бот — в чат, привязанный к номеру (см. tasks/telegram.py);
  5) если ни один канал не настроен/недоступен — код пишется в лог (dev-вход).
"""

import logging

from sqlalchemy import select

from core import smsaero, telegram
from core.celery_app import celery_app
from core.config import settings
from core.models import User
from tasks.base import make_engine, make_session, run_async

logger = logging.getLogger(__name__)

# Время жизни (сек) задачи, за которое воркер должен успеть её обработать,
# прежде чем Celery решит, что она зависла. 5 минут с запасом.
_OTP_TASK_MAX_SECONDS = 300


def _bound_telegram_chat(phone_number: str) -> int | None:
    """Возвращает привязанный к номеру Telegram-чат (или None)."""
    return run_async(_bound_telegram_chat_async(phone_number))


async def _bound_telegram_chat_async(phone_number: str) -> int | None:
    engine = make_engine()
    session = make_session(engine)
    try:
        user = (
            await session.execute(select(User).where(User.phone_number == phone_number))
        ).scalar_one_or_none()
        return user.tg_chat_id if user is not None else None
    finally:
        await session.close()
        await engine.dispose()


@celery_app.task(
    name="tasks.otp_tasks.send_sms_otp",
    bind=True,
    max_retries=3,
    default_retry_delay=5,
    soft_time_limit=_OTP_TASK_MAX_SECONDS,
    acks_late=False,
)
def send_sms_otp(self, phone_number: str, otp_code: str) -> None:
    """Доставляет OTP-код (код в Telegram → SMS Aero → Gateway → бот → лог)."""
    ttl_seconds = settings.auth_otp_expire_seconds
    sms_text = f"Pismo: код входа {otp_code}. Никому не сообщайте код."

    # 1) «Код в Telegram» через SMS Aero — самый дешёвый канал (≈2,5 ₽ против
    # ≈9 ₽ за SMS) с автоматическим откатом на SMS, если Telegram не доставить.
    if settings.sms_aero_email and settings.sms_aero_api_key:
        try:
            msg_id = smsaero.send_telegram_code(phone_number, otp_code, sms_text)
            logger.info(
                "OTP для %s отправлен кодом в Telegram (SMS Aero, id=%s)",
                phone_number,
                msg_id,
            )
            return
        except smsaero.SmsAeroError as exc:
            logger.warning("Код в Telegram не отправлен (%s) — пробую SMS", exc)

    # 2) SMS Aero — обычное SMS на телефон (дороже, но работает всегда).
    if settings.sms_aero_email and settings.sms_aero_api_key:
        try:
            msg_id = smsaero.send_sms(phone_number, sms_text)
            logger.info(
                "OTP для %s отправлен по SMS (SMS Aero, id=%s)",
                phone_number,
                msg_id,
            )
            return
        except smsaero.SmsAeroError as exc:
            logger.warning("SMS Aero недоступен (%s) — переключаюсь на Telegram", exc)

    # 3) Telegram Gateway — доп. канал (верификационное сообщение).
    if settings.telegram_gateway_token:
        try:
            request_id = telegram.gateway_send_verification(
                phone_number, otp_code, ttl_seconds
            )
            logger.info(
                "OTP для %s отправлен через Telegram Gateway (request_id=%s)",
                phone_number,
                request_id,
            )
            return
        except telegram.TelegramApiError as exc:
            logger.warning(
                "Telegram Gateway недоступен (%s) — переключаюсь на бота", exc
            )

    # 4) Обычный бот — если к этому номеру привязан Telegram-чат.
    if settings.telegram_bot_token:
        chat_id = _bound_telegram_chat(phone_number)
        if chat_id is not None:
            try:
                text = (
                    f"🔐 Код подтверждения Pismo: {otp_code}\n"
                    "Никому не сообщайте код."
                )
                telegram.bot_send_message(chat_id, text)
                logger.info(
                    "OTP для %s отправлен в Telegram-чат %s",
                    phone_number,
                    chat_id,
                )
                return
            except telegram.TelegramApiError as exc:
                logger.warning("Telegram-бот не смог доставить код (%s)", exc)

    # 5) Dev-fallback: каналы не настроены или недоступны — печатаем код.
    logger.info("SMS-заглушка (dev): OTP-код для %s -> %s", phone_number, otp_code)
