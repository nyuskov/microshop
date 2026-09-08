"""Периодическая задача: обработка сообщений обычного Telegram-бота.

Бот — резервный канал доставки OTP (когда Telegram Gateway не настроен или
недоступен). Пользователь привязывает свой Telegram-чат к аккаунту:

* на сайте (после входа по телефону) создаётся короткий код привязки
  (``TelegramBindLink``) и показывается ссылка ``t.me/<bot>?start=bind_<код>``;
* пользователь открывает ссылку и жмёт Start;
* эта задача (по расписанию celery beat) забирает апдейты бота long polling'ом,
  видит ``/start bind_<код>``, проставляет ``user.tg_chat_id`` и удаляет ссылку.

Дальше доставка кода в этот чат — прямой ``sendMessage`` (бот может писать
пользователю, который его запустил). Внешний публичный webhook не нужен.
"""

import logging
import time
from datetime import datetime, timezone

from sqlalchemy import select

from core import telegram
from core.celery_app import celery_app
from core.config import settings
from core.models import TelegramBindLink, User
from tasks.base import make_engine, make_session, run_async

logger = logging.getLogger(__name__)

_MSG_OK = "✅ Аккаунт привязан: коды входа будут приходить в этот чат."
_MSG_INVALID = (
    "❌ Ссылка недействительна или устарела. Запросите новую на сайте "
    "(Настройки профиля → Привязать Telegram)."
)
_MSG_HELP = "Чтобы получать коды входа в этом чате, откройте ссылку привязки на сайте."

# Состояние поллинга в памяти (воркер у нас с --concurrency=1, процесс один).
_LAST_UPDATE_ID: int | None = None
_SEEN_UPDATE_IDS: set[int] = set()
_MAX_SEEN = 2000

# Бэкофф при недоступности api.telegram.org: не долбим сеть каждые 5 сек
# (на части хостингов исходящий доступ к Telegram заблокирован). После серии
# ошибок пауза растёт до _POLL_BACKOFF_MAX_SECONDS и сбрасывается при успехе.
_NEXT_POLL_AT: float = 0.0
_POLL_FAILURES: int = 0
_POLL_BACKOFF_BASE_SECONDS = 10
_POLL_BACKOFF_MAX_SECONDS = 600


def _seen_update(update_id: int) -> bool:
    if update_id in _SEEN_UPDATE_IDS:
        return True
    _SEEN_UPDATE_IDS.add(update_id)
    if len(_SEEN_UPDATE_IDS) > _MAX_SEEN:
        # Держим множество ограниченным: выбрасываем самые старые.
        for old in sorted(_SEEN_UPDATE_IDS)[: _MAX_SEEN // 2]:
            _SEEN_UPDATE_IDS.discard(old)
    return False


@celery_app.task(
    name="tasks.telegram.telegram_poll_updates",
    bind=True,
    max_retries=2,
    default_retry_delay=10,
    soft_time_limit=60,
)
def telegram_poll_updates(self) -> None:
    """Один «тик» поллинга апдейтов бота (вызывается celery beat)."""
    # noqa: PLW0603 - состояние поллинга держим в памяти процесса
    global _LAST_UPDATE_ID, _NEXT_POLL_AT, _POLL_FAILURES
    if not settings.telegram_bot_token:
        return
    if time.monotonic() < _NEXT_POLL_AT:
        return  # сеть/API недоступны — ждём окончания бэкоффа
    try:
        updates = telegram.bot_get_updates(
            offset=((_LAST_UPDATE_ID + 1) if _LAST_UPDATE_ID is not None else None),
            timeout=5,
        )
    except telegram.TelegramApiError as exc:
        _POLL_FAILURES += 1
        delay = min(
            _POLL_BACKOFF_MAX_SECONDS,
            _POLL_BACKOFF_BASE_SECONDS * (2 ** min(_POLL_FAILURES - 1, 6)),
        )
        _NEXT_POLL_AT = time.monotonic() + delay
        logger.warning("getUpdates: %s — следующая попытка через %ss", exc, delay)
        return
    _POLL_FAILURES = 0
    _NEXT_POLL_AT = 0.0

    max_id = _LAST_UPDATE_ID
    for update in updates:
        update_id = update.get("update_id")
        if update_id is None:
            continue
        max_id = update_id if max_id is None else max(max_id, update_id)
        if _seen_update(update_id):
            continue
        message = update.get("message") or {}
        chat_id = (message.get("chat") or {}).get("id")
        text = (message.get("text") or "").strip()
        if not isinstance(chat_id, int) or not text.startswith("/start"):
            continue
        payload = text[len("/start") :].strip()
        try:
            reply = _handle_start(payload, chat_id)
        except telegram.TelegramApiError as exc:
            logger.warning("Не удалось ответить ботом (%s)", exc)
            continue
        except Exception:  # noqa: BLE001 - не роняем поллинг из-за одной команды
            logger.exception("Ошибка обработки /start (chat=%s)", chat_id)
            continue
        if reply:
            try:
                telegram.bot_send_message(chat_id, reply)
            except telegram.TelegramApiError as exc:
                logger.warning("Не удалось отправить ответ бота (%s)", exc)

    if max_id is not None:
        _LAST_UPDATE_ID = max_id


def _handle_start(payload: str, chat_id: int) -> str:
    """Обрабатывает /start: привязка по bind_<код> либо справка."""
    if not payload.startswith("bind_"):
        return _MSG_HELP
    code = payload[len("bind_") :].strip()
    if not code:
        return _MSG_INVALID
    return run_async(_resolve_bind(code, chat_id))


async def _resolve_bind(code: str, chat_id: int) -> str:
    engine = make_engine()
    session = make_session(engine)
    try:
        link = await session.get(TelegramBindLink, code)
        if link is None:
            return _MSG_INVALID

        user = (
            await session.execute(select(User).where(User.id == link.user_id))
        ).scalar_one_or_none()

        expired = link.expires_at < datetime.now(timezone.utc)
        if user is None or expired:
            await session.delete(link)
            await session.commit()
            return _MSG_INVALID

        user.tg_chat_id = chat_id
        await session.delete(link)
        await session.commit()
        logger.info("Telegram-чат %s привязан к user #%s", chat_id, user.id)
        return _MSG_OK
    finally:
        await session.close()
        await engine.dispose()
