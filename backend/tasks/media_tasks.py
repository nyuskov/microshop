"""Фоновые задачи воркера, работающие с media и БД (Celery + RabbitMQ).

* ``download_gif_message`` — скачивает GIF из интернета (Giphy/Tenor) и
  создаёт сообщение-вложение, как раньше делал синхронный эндпоинт. Перенос в
  воркер снимает «тяжёлую» сетевую загрузку с блока запроса FastAPI.
* ``cleanup_orphan_media`` — периодическая очистка файлов media, на которые
  нет ссылок в БД (расписание в ``core.celery_app``, celery beat).

Обе задачи асинхронные (SQLAlchemy async), поэтому исполняются через
``tasks.base.run_async`` со свежим движком БД внутри одного event loop.
"""

import asyncio
import logging
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler
from urllib.request import Request as UrlRequest
from urllib.request import build_opener

from sqlalchemy import select

from core.celery_app import celery_app
from core.config import settings
from core.media_store import store_media
from core.media_usage import collect_used_media_names
from core.models import Chat, Message, user_chat_association_table
from tasks.base import make_engine, make_session, run_async
from tasks.notifications import publish_realtime_new_message

logger = logging.getLogger(__name__)

# Каталог вложений сообщений (соседствует с web; воркер и web шаpят этот каталог
# через volume/bind-mount — см. docker-compose).
MEDIA_DIR = Path(__file__).resolve().parent.parent / "media"
MAX_UPLOAD_SIZE = settings.max_upload_size_bytes
MAX_UPLOAD_MB = MAX_UPLOAD_SIZE // (1024 * 1024)

# Хосты, с которых разрешено импортировать GIF.
ALLOWED_GIF_HOSTS = {
    "giphy.com",
    "media.giphy.com",
    "media0.giphy.com",
    "media1.giphy.com",
    "media2.giphy.com",
    "media3.giphy.com",
    "media4.giphy.com",
    "i.giphy.com",
    "media.tenor.com",
    "c.tenor.com",
}


class _NoRedirectHandler(HTTPRedirectHandler):
    """Запрещает следовать HTTP-редиректам при скачивании (защита от SSRF)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl) -> None:
        raise HTTPError(req.full_url, code, msg, headers, fp)


def _download_bytes(url: str, limit: int) -> bytes:
    """Скачивает содержимое по URL без редиректов (синхронно, в воркере)."""
    req = UrlRequest(url, headers={"User-Agent": "pismo/1.0"})
    opener = build_opener(_NoRedirectHandler)
    try:
        with opener.open(req, timeout=20) as response:
            content = response.read(limit + 1)
            content_type = response.headers.get("Content-Type", "")
    except HTTPError as exc:
        raise ValueError("Недопустимый адрес GIF") from exc
    except OSError as exc:
        raise ValueError("Не удалось загрузить GIF") from exc

    if len(content) > limit:
        raise ValueError(f"GIF слишком большой (максимум {MAX_UPLOAD_MB} МБ)")
    if not (
        content_type.lower().startswith("image/gif")
        or content[:6] in (b"GIF87a", b"GIF89a")
    ):
        raise ValueError("URL не ведёт на GIF-изображение")
    return content


@celery_app.task(
    name="tasks.media_tasks.download_gif_message",
    bind=True,
    max_retries=2,
    default_retry_delay=5,
    soft_time_limit=90,
)
def download_gif_message(
    self,
    chat_id: int,
    user_id: int,
    url: str,
    reply_to_id: int | None = None,
    caption: str = "",
) -> None:
    """Скачивает GIF и создаёт сообщение-вложение (вызывается воркером).

    ``caption`` — подпись к гифке (текст из поля ввода на момент отправки).

    При успехе публикует ``message.new`` в мост realtime-событий. Ошибки
    валидации/сети не ретраим (бессмысленно для плохого URL); исключения БД —
    тоже, чтобы не копить вечные задачи. Только временные сетевые сбои
    воркер может ретраить через ``self.retry`` по требованию.
    """
    try:
        run_async(
            _download_gif_message_async(
                chat_id=chat_id,
                user_id=user_id,
                url=url,
                reply_to_id=reply_to_id,
                caption=caption,
            )
        )
    except ValueError as exc:
        # Пользователю уйдёт «тихое» отсутствие сообщения; логируем лишь причину.
        logger.warning("GIF-задача отклонена (chat=%s): %s", chat_id, exc)
    except Exception:  # защита воркера от падения
        logger.exception("GIF-задача упала (chat=%s, url=%s)", chat_id, url)


async def _download_gif_message_async(
    *,
    chat_id: int,
    user_id: int,
    url: str,
    reply_to_id: int | None = None,
    caption: str = "",
) -> None:
    from urllib.parse import urlparse

    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if (
        parsed.scheme not in ("http", "https")
        or host not in ALLOWED_GIF_HOSTS
        or parsed.port is not None
        or parsed.username is not None
    ):
        raise ValueError("Недопустимый адрес GIF")

    content = await asyncio.to_thread(_download_bytes, url, MAX_UPLOAD_SIZE)

    engine = make_engine()
    session = make_session(engine)
    try:
        # Квота: GIF качается воркером асинхронно, поэтому проверяем и здесь —
        # иначе накопить файлы можно было бы в обход ограничения (см. media_quota).
        from core.media_quota import enforce_media_quota

        await enforce_media_quota(session, user_id=user_id, incoming_bytes=len(content))

        # Проверяем, что чат существует и пользователь в нём состоит.
        chat = await session.get(Chat, chat_id)
        if chat is None:
            raise ValueError("Чат не найден")
        membership = await session.execute(
            select(user_chat_association_table.c.user_id).where(
                user_chat_association_table.c.chat_id == chat_id,
                user_chat_association_table.c.user_id == user_id,
            )
        )
        if membership.scalar_one_or_none() is None:
            raise ValueError("Пользователь не участник чата")

        # Если GIF — ответ на сообщение, проверяем, что оно в том же чате.
        if reply_to_id is not None:
            reply_target = await session.get(Message, reply_to_id)
            if reply_target is None or reply_target.chat_id != chat_id:
                raise ValueError("Нельзя ответить на это сообщение")

        # Файл пишем на диск только после всех проверок (включая квоту).
        file_url = await asyncio.to_thread(store_media, content, ".gif")

        message = Message(
            text=caption[:4000],
            chat_id=chat_id,
            user_id=user_id,
            reply_to_id=reply_to_id,
            file_name=f"gif_{uuid.uuid4().hex[:8]}.gif",
            file_url=file_url,
            mime_type="image/gif",
            file_size=len(content),
        )
        session.add(message)
        await session.commit()
        await session.refresh(message)

        # Кому раздавать сообщение: ВСЕ участники чата, включая отправителя.
        # Обычные сообщения sender добавляет локально из ответа эндпоинта, но
        # GIF теперь создаётся асинхронно и ответа-сообщения нет — поэтому
        # отправителю тоже нужно событие, чтобы лента обновилась.
        rows = await session.execute(
            select(user_chat_association_table.c.user_id).where(
                user_chat_association_table.c.chat_id == chat_id
            )
        )
        recipient_ids = list(rows.scalars().all())
    finally:
        await session.close()
        await engine.dispose()

    if recipient_ids:
        await publish_realtime_new_message(
            recipient_ids=recipient_ids,
            chat_id=chat_id,
            message_id=int(message.id),
            sender_id=user_id,
        )


@celery_app.task(
    name="tasks.media_tasks.cleanup_orphan_media",
    max_retries=0,
    soft_time_limit=300,
)
def cleanup_orphan_media(delete: bool = True) -> dict[str, int]:
    """Находит и (по умолчанию) удаляет файлы media без ссылок в БД.

    Раньше это был ручной скрипт ``python -m scripts.cleanup_orphan_media``.
    Теперь запускается по расписанию celery beat (см. core.celery_app).

    Набор «используемых» имён берём из ``core.media_usage`` — оттуда же, откуда
    его берёт скрипт. Своя копия выборок в этой задаче уже приводила к потере
    живых файлов (стикеры библиотеки, иконки уведомлений), поэтому списки только
    общие.
    """
    return run_async(_cleanup_async(delete=delete))


async def _cleanup_async(*, delete: bool) -> dict[str, int]:
    engine = make_engine()
    session = make_session(engine)
    try:
        used = await collect_used_media_names(session)
    finally:
        await session.close()
        await engine.dispose()

    removed = 0
    for folder in (MEDIA_DIR, MEDIA_DIR / "avatars"):
        if not folder.is_dir():
            continue
        for path in folder.iterdir():
            if path.is_file() and path.name not in used:
                if delete:
                    path.unlink(missing_ok=True)
                removed += 1
    logger.info("cleanup_orphan_media: delete=%s, файлов = %s", delete, removed)
    return {"delete": delete, "removed": removed}
