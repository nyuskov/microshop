from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_user
from api_v1.media_quota import enforce_media_quota, media_usage
from api_v1.media_store import store_media
from api_v1.messages import crud
from api_v1.messages.schemas import (
    ChatMediaItem,
    EditMessageRequest,
    ForwardMessageRequest,
)
from api_v1.messages.schemas import Message as MessageSchema
from api_v1.messages.schemas import MessageCreate
from api_v1.rate_limit import enforce_limit
from api_v1.upload_guard import validate_attachment_upload
from core.celery_app import get_task
from core.config import settings
from core.models import User, db_helper

router = APIRouter(
    prefix="/messages",
    tags=["Messages"],
)

# Лимит размера вложения настраивается через env (см. Settings.max_upload_size_bytes).
MAX_UPLOAD_SIZE = settings.max_upload_size_bytes
MAX_UPLOAD_MB = MAX_UPLOAD_SIZE // (1024 * 1024)


async def _enforce_user_rate_limit(user: User, *, scope: str, limit: int) -> None:
    """Per-user лимит (по user.id) на «дорогие»/«писательские» действия."""
    await enforce_limit(
        scope=scope,
        value=str(user.id),
        limit=limit,
        window_seconds=60,
        detail="Слишком много запросов. Попробуйте позже.",
    )


class PinRequest(BaseModel):
    is_pinned: bool


class ReactionRequest(BaseModel):
    emoji: str


class GifMessageCreate(BaseModel):
    chat_id: int
    url: str
    reply_to_id: int | None = None


class MarkChatReadRequest(BaseModel):
    chat_id: int


@router.post("/", response_model=MessageSchema)
async def create_new_message(
    message: MessageCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Отправляет текстовое сообщение от имени текущего пользователя."""
    await _enforce_user_rate_limit(
        user,
        scope="messages:send",
        limit=settings.message_send_limit_per_minute,
    )
    return await crud.send_text_message(
        session=session,
        chat_id=message.chat_id,
        text=message.text,
        user_id=user.id,
        reply_to_id=message.reply_to_id,
        encrypted=message.encrypted,
    )


@router.post("/read/")
async def mark_chat_read(
    payload: MarkChatReadRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, bool]:
    """Помечает чат прочитанным (кнопка push «Пометить как прочитанное»)."""
    ok = await crud.mark_chat_read(
        session=session, chat_id=payload.chat_id, user_id=user.id
    )
    return {"ok": ok}


@router.patch("/{message_id}/", response_model=MessageSchema)
async def edit_message(
    message_id: int,
    payload: EditMessageRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Редактирует текст своего сообщения."""
    return await crud.edit_message_text(
        session=session,
        message_id=message_id,
        user_id=user.id,
        text=payload.text,
    )


@router.post("/forward/", response_model=MessageSchema)
async def forward_message(
    payload: ForwardMessageRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Пересылает сообщение из одного своего чата в другой."""
    await _enforce_user_rate_limit(
        user,
        scope="messages:forward",
        limit=settings.message_forward_limit_per_minute,
    )
    return await crud.forward_message(
        session=session,
        source_message_id=payload.message_id,
        user_id=user.id,
        chat_id=payload.chat_id,
        reply_to_id=payload.reply_to_id,
    )


@router.post("/attachment/", response_model=MessageSchema)
async def create_attachment_message(
    request: Request,
    chat_id: int = Query(...),
    filename: str = Query(..., min_length=1, max_length=255),
    caption: str = Query(default="", max_length=4000),
    reply_to_id: int | None = Query(default=None),
    mime: str | None = Query(default=None, max_length=120),
    encrypted: bool = Query(default=False),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Отправляет файл/изображение как сообщение (тело запроса — байты файла).

    При ``encrypted=true`` тело — уже зашифрованный на клиенте блоб
    (имя файла нейтральное, ``application/octet-stream``), поэтому проверять
    расширение и сигнатуры нечего: сервер такие данные не читает.
    """
    await _enforce_user_rate_limit(
        user,
        scope="messages:upload",
        limit=settings.message_upload_limit_per_minute,
    )
    content = await request.body()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пустой файл",
        )
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Файл слишком большой (максимум {MAX_UPLOAD_MB} МБ)",
        )

    if not encrypted:
        validate_attachment_upload(filename, content)
    # Квота проверяется до записи на диск (см. api_v1/media_quota.py).
    await enforce_media_quota(session, user_id=user.id, incoming_bytes=len(content))

    file_url = store_media(content, Path(filename).suffix)
    return await crud.send_attachment_message(
        session=session,
        chat_id=chat_id,
        user_id=user.id,
        file_name=Path(filename).name,
        file_url=file_url,
        mime_type=mime,
        file_size=len(content),
        text=caption.strip(),
        reply_to_id=reply_to_id,
        encrypted=encrypted,
    )


# Хосты, с которых разрешено импортировать GIF. Используются и для «быстрой»
# валидации в эндпоинте (до постановки в очередь), и воркером для финальной.
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


class GifQueueAccepted(BaseModel):
    """Ответ о постановке GIF-задачи в очередь (сообщение ещё не создано)."""

    status: str = "accepted"
    detail: str = "GIF обрабатывается в фоне и появится в чате автоматически"


@router.post(
    "/gif/",
    response_model=GifQueueAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def send_gif_message(
    payload: GifMessageCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> GifQueueAccepted:
    """Ставит в очередь Celery скачивание GIF и создание сообщения.

    Раньше GIF скачивался синхронно в теле запроса (через ``asyncio.to_thread``),
    удерживая соединение на время сетевой загрузки. Теперь эндпоинт только
    валидирует URL (быстрый отказ при неверном адресе) и кладёт задачу в
    RabbitMQ. Фоновый воркер (``tasks.media_tasks.download_gif_message``)
    скачивает файл, пишет его в общий media-каталог и создаёт сообщение в БД,
    после чего через мост realtime-событий web уведомляет живые WebSocket-клиенты
    (``message.new``) — сообщение появляется в чате автоматически.
    """
    await _enforce_user_rate_limit(
        user,
        scope="messages:gif",
        limit=settings.message_upload_limit_per_minute,
    )
    parsed = urlparse(payload.url)
    host = (parsed.hostname or "").lower()
    if (
        parsed.scheme not in ("http", "https")
        or host not in ALLOWED_GIF_HOSTS
        or parsed.port is not None
        or parsed.username is not None
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Недопустимый адрес GIF",
        )

    # Размер GIF узнаем только после скачивания (в воркере), поэтому здесь
    # отсекаем случай, когда места уже нет совсем — человек получает понятную
    # ошибку сразу, а не «загрузка ничего не сделала».
    usage = await media_usage(session, user_id=user.id)
    if usage.free_bytes <= 0:
        await enforce_media_quota(session, user_id=user.id, incoming_bytes=1)

    try:
        get_task("tasks.media_tasks.download_gif_message").delay(
            chat_id=payload.chat_id,
            user_id=user.id,
            url=payload.url,
            reply_to_id=payload.reply_to_id,
        )
    except Exception:  # noqa: BLE001 - очередь (RabbitMQ) может быть недоступна
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Сервис обработки GIF временно недоступен. Попробуйте позже.",
        )
    return GifQueueAccepted()


@router.get("/search/", response_model=list[MessageSchema])
async def search_messages_endpoint(
    q: str = Query(default="", min_length=1, max_length=200),
    chat_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Ищет сообщения по тексту/имени файла (в чате или во всех чатах)."""
    query = q.strip()
    if not query:
        return []
    await _enforce_user_rate_limit(
        user,
        scope="messages:search",
        limit=settings.message_search_limit_per_minute,
    )
    return await crud.search_messages(
        session,
        user_id=user.id,
        query=query,
        chat_id=chat_id,
        limit=limit,
    )


@router.get("/{chat_id}/", response_model=list[MessageSchema])
async def get_messages_for_chat(
    chat_id: int,
    # По умолчанию отдаём последнюю страницу (не всю историю): за более
    # старыми клиент идёт пагинацией через limit+before_id.
    limit: int = Query(default=100, ge=1, le=500),
    before_id: int | None = Query(default=None, ge=1),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Возвращает сообщения чата и помечает входящие как прочитанные.

    Без параметров — последние ``limit`` (100) сообщений. Поддерживает
    пагинацию ``limit`` + ``before_id`` (для «более старых»).
    """
    return await crud.list_chat_messages(
        session=session,
        chat_id=chat_id,
        user_id=user.id,
        limit=limit,
        before_id=before_id,
    )


@router.get("/{chat_id}/media/", response_model=list[ChatMediaItem])
async def get_chat_media(
    chat_id: int,
    # image/video/audio/file — вкладки галереи; без параметра отдаём все вложения.
    kind: str | None = Query(default=None, pattern="^(image|video|audio|file)$"),
    limit: int = Query(default=60, ge=1, le=200),
    before_id: int | None = Query(default=None, ge=1),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Вложения чата для галереи «Медиа/Файлы».

    Галерея не должна зависеть от того, какие страницы истории уже загружены в
    ленте: сервер сам выбирает сообщения с вложением. Пагинация — ``before_id``
    (вложения старее указанного сообщения), порядок — от новых к старым.

    В зашифрованном чате возвращается пустой список: содержимое вложений
    зашифровано ключом чата, и галерея строится из загруженной истории.
    """
    return await crud.list_chat_media(
        session=session,
        chat_id=chat_id,
        user_id=user.id,
        kind=kind,
        limit=limit,
        before_id=before_id,
    )


@router.get("/{chat_id}/pinned/", response_model=list[MessageSchema])
async def get_pinned_messages(
    chat_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Возвращает закреплённые сообщения чата."""
    return await crud.list_pinned_messages(
        session=session,
        chat_id=chat_id,
        user_id=user.id,
    )


@router.patch("/{message_id}/pin/", response_model=MessageSchema)
async def toggle_pin_message(
    message_id: int,
    payload: PinRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Закрепляет или открепляет сообщение."""
    return await crud.set_message_pinned(
        session=session,
        message_id=message_id,
        user_id=user.id,
        is_pinned=payload.is_pinned,
    )


@router.put("/{message_id}/reaction/", response_model=MessageSchema)
async def add_reaction(
    message_id: int,
    payload: ReactionRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Устанавливает реакцию текущего пользователя на сообщение."""
    return await crud.set_reaction(
        session=session,
        message_id=message_id,
        user_id=user.id,
        emoji=payload.emoji,
    )


@router.delete("/{message_id}/reaction/", response_model=MessageSchema)
async def remove_reaction(
    message_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Снимает реакцию текущего пользователя с сообщения."""
    return await crud.set_reaction(
        session=session,
        message_id=message_id,
        user_id=user.id,
        emoji=None,
    )


@router.delete("/{message_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    message_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Удаляет сообщение (только автор)."""
    await crud.delete_message(
        session=session,
        message_id=message_id,
        user_id=user.id,
    )
