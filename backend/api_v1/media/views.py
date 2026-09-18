"""Раздача файлов из ``media`` (вложения, аватары, истории, предпросмотры).

Зачем не отдавать статикой (как раньше, ``StaticFiles``): файлы на диске лежат
зашифрованными (``core/media_crypto.py``), а расшифровать их может только
приложение. nginx лишь проксирует ``/media/`` сюда.

Что здесь важно:

* **HTTP Range**. Без частичных запросов не работает перемотка видео и докачка
  больших файлов; браузер просит «байты 5000000–», а мы расшифровываем только
  нужные куски (см. ``media_crypto.iter_plaintext``).
* **Память**. Файлы отдаются потоком, а не целиком: видео на 300 МБ не должно
  занимать столько же в памяти процесса.
* **Пути**. Имя приходит из URL, поэтому любой выход за пределы каталога (``..``,
  абсолютный путь, симлинк наружу) — это 404, а не чтение чужого файла.
* **Типы**. ``Content-Type`` берём по расширению, но никогда не отдаём
  html/svg/xml: под этим расширением мог бы приехать «активный» контент
  (защита от stored-XSS, см. ``core/upload_guard.py``).
"""

from __future__ import annotations

import logging
import mimetypes
from datetime import datetime, timezone
from email.utils import formatdate, parsedate_to_datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

from core import media_crypto
from core.media_store import VIEW_ONCE_PREFIX, remove_media
from core.models import Message, db_helper

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Медиа"])

MEDIA_DIR = Path(__file__).resolve().parent.parent.parent / "media"

#: Типы, которые браузер исполняет или рендерит как документ. Даже если файл
#: лежит с таким расширением, отдаём его как поток байт.
DANGEROUS_TYPES = {
    "text/html",
    "application/xhtml+xml",
    "text/xml",
    "application/xml",
    "image/svg+xml",
}


def _resolve(name: str) -> Path:
    """Файл внутри каталога media по относительному имени (иначе 404)."""
    root = MEDIA_DIR.resolve()
    candidate = (root / name).resolve()
    if not candidate.is_relative_to(root) or candidate == root:
        # Попытка выйти за пределы каталога (``..``, абсолютный путь, симлинк).
        logger.warning("Запрос media вне каталога: %r", name)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Файл не найден"
        )
    if not candidate.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Файл не найден"
        )
    return candidate


def _content_type(name: str) -> str:
    """Тип содержимого по расширению (безопасный по умолчанию)."""
    guessed, _ = mimetypes.guess_type(name)
    if not guessed or guessed in DANGEROUS_TYPES:
        return "application/octet-stream"
    return guessed


def _etag(total: int, mtime: float) -> str:
    """Тег версии файла: размер и время изменения."""
    return f'"{total:x}-{int(mtime):x}"'


def _not_modified(request: Request, etag: str, mtime: float) -> bool:
    """Можно ли ответить 304 (файл у клиента уже свежий)."""
    if_none_match = request.headers.get("if-none-match")
    if if_none_match is not None:
        return if_none_match.strip() == etag or if_none_match.strip() == "*"
    if_modified_since = request.headers.get("if-modified-since")
    if if_modified_since:
        try:
            since = parsedate_to_datetime(if_modified_since)
        except (TypeError, ValueError):
            return False
        return since is not None and int(mtime) <= int(since.timestamp())
    return False


def _parse_range(value: str, total: int) -> tuple[int, int] | None:
    """Разбирает ``Range`` для одного диапазона.

    ``None`` — заголовок нам не подходит (несколько диапазонов, мусор): тогда
    отдаём файл целиком, как разрешает спецификация. ``416`` — диапазон за
    пределами файла.
    """
    raw = value.strip()
    if not raw.startswith("bytes="):
        return None
    spec = raw[len("bytes=") :].strip()
    if "," in spec or "-" not in spec:
        return None
    first, _, last = spec.partition("-")
    first, last = first.strip(), last.strip()
    try:
        if not first:
            # ``bytes=-500`` — последние 500 байт.
            length = int(last)
            if length <= 0:
                return None
            start = max(total - length, 0)
            return start, total - 1
        start = int(first)
        end = int(last) if last else total - 1
    except ValueError:
        return None
    if start >= total or start > end:
        raise HTTPException(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            detail="Диапазон за пределами файла",
            headers={"Content-Range": f"bytes */{total}"},
        )
    return start, min(end, total - 1)


@router.api_route("/{name:path}", methods=["GET", "HEAD"])
async def serve_media(
    request: Request,
    name: str,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> Response:
    """Отдаёт файл из media целиком или запрошенный диапазон байт.

    Одноразовое вложение (``messages.view_once``) отдаётся ровно один раз:
    первый GET возвращает файл и удаляет блоб, дальше — «истёк». HEAD не
    расходует просмотр: браузеры сами щупают файл перед загрузкой.
    """
    # В БД ходим ТОЛЬКО для одноразовых файлов (их имя помечено префиксом):
    # обычная раздача картинок остаётся без запросов к базе.
    view_once = (
        await _view_once_state(session, name)
        if name.startswith(VIEW_ONCE_PREFIX)
        else None
    )
    if view_once is not None and view_once["opened"]:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Одноразовое вложение уже просмотрено",
        )
    path = _resolve(name)
    try:
        stat = path.stat()
    except OSError:
        # Файл исчез между проверкой и чтением (например, чистка «сирот»).
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Файл не найден"
        ) from None
    if media_crypto.is_encrypted_file(path) and not media_crypto.is_enabled():
        # Файлы зашифрованы, а ключа в окружении нет: чинить может только
        # администратор (добавить AT_REST_KEY и перезапустить web). Проверяем это
        # ДО ответа: иначе поток уже начал бы отдаваться и оборвался на середине.
        logger.error("Зашифрованное медиа запрошено без AT_REST_KEY: %s", name)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Медиа временно недоступно",
        )
    try:
        total = media_crypto.plaintext_size(path)
    except media_crypto.MediaKeyMissing:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Медиа временно недоступно",
        ) from None
    except ValueError:
        logger.exception("Повреждённый файл media: %s", name)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Файл повреждён",
        ) from None

    etag = _etag(total, stat.st_mtime)
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": _content_type(name),
        "ETag": etag,
        "Last-Modified": formatdate(stat.st_mtime, usegmt=True),
    }

    if _not_modified(request, etag, stat.st_mtime):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)

    start, end = 0, total - 1
    code = status.HTTP_200_OK
    range_header = request.headers.get("range")
    # If-Range: если файл успел измениться, диапазон применять нельзя — отдаём
    # файл целиком (иначе клиент соберёт битую картинку из старых и новых байт).
    if_range = request.headers.get("if-range")
    if range_header and total > 0 and if_range in (None, etag):
        parsed = _parse_range(range_header, total)
        if parsed is not None:
            start, end = parsed
            code = status.HTTP_206_PARTIAL_CONTENT

    headers["Content-Length"] = str(end - start + 1)
    if code == status.HTTP_206_PARTIAL_CONTENT:
        headers["Content-Range"] = f"bytes {start}-{end}/{total}"

    if request.method == "HEAD":
        return Response(status_code=code, headers=headers)
    if view_once is not None:
        # Отметку ставим ДО отдачи: иначе два параллельных запроса оба увидели
        # бы «ещё не открыто» и вложение выдали бы дважды.
        await _mark_view_once_opened(session, message_id=view_once["message_id"])
    response = StreamingResponse(
        media_crypto.iter_plaintext(path, start, end + 1),
        status_code=code,
        headers=headers,
    )
    if view_once is not None:
        # Блоб удаляем ПОСЛЕ отдачи: поток читает файл лениво, и удаление раньше
        # оборвало бы уже начатый ответ.
        response.background = BackgroundTask(remove_media, f"/media/{name}")
    return response


async def _view_once_state(session: AsyncSession, name: str) -> dict | None:
    """Состояние одноразового вложения по имени файла (None — не одноразовое)."""
    row = await session.execute(
        select(Message.id, Message.view_once_opened_at).where(
            Message.view_once.is_(True),
            # file_url хранится как «/media/<имя>»; сравниваем по хвосту: имя из
            # URL уже проверено (_resolve) и не содержит «..».
            Message.file_url.like(f"%/{name}"),
        )
    )
    found = row.first()
    if found is None:
        return None
    return {"message_id": found[0], "opened": found[1] is not None}


async def _mark_view_once_opened(session: AsyncSession, *, message_id: int) -> None:
    """Помечает одноразовое вложение открытым (повторно не выдаётся)."""
    await session.execute(
        update(Message)
        .where(Message.id == message_id, Message.view_once_opened_at.is_(None))
        .values(view_once_opened_at=datetime.now(timezone.utc).replace(tzinfo=None))
    )
    await session.commit()
