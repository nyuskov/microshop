import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_user
from api_v1.messages import crud
from api_v1.messages.schemas import Message as MessageSchema
from api_v1.messages.schemas import MessageCreate
from core.models import User, db_helper

router = APIRouter(
    prefix="/messages",
    tags=["Messages"],
)

MEDIA_DIR = Path(__file__).resolve().parent.parent.parent / "media"
MAX_UPLOAD_SIZE = 15 * 1024 * 1024  # 15 МБ


class PinRequest(BaseModel):
    is_pinned: bool


class ReactionRequest(BaseModel):
    emoji: str


def _store_upload(content: bytes, filename: str) -> str:
    """Сохраняет файл в media-каталог и возвращает относительный URL."""
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(filename).suffix.lower()
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    (MEDIA_DIR / stored_name).write_bytes(content)
    return f"/media/{stored_name}"


@router.post("/", response_model=MessageSchema)
async def create_new_message(
    message: MessageCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Отправляет текстовое сообщение от имени текущего пользователя."""
    return await crud.send_text_message(
        session=session,
        chat_id=message.chat_id,
        text=message.text,
        user_id=user.id,
        reply_to_id=message.reply_to_id,
    )


@router.post("/attachment/", response_model=MessageSchema)
async def create_attachment_message(
    request: Request,
    chat_id: int = Query(...),
    filename: str = Query(..., min_length=1, max_length=255),
    caption: str = Query(default="", max_length=4000),
    reply_to_id: int | None = Query(default=None),
    mime: str | None = Query(default=None, max_length=120),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Отправляет файл/изображение как сообщение (тело запроса — байты файла)."""
    content = await request.body()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пустой файл",
        )
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Файл слишком большой (максимум 15 МБ)",
        )

    file_url = _store_upload(content, filename)
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
    )


@router.get("/{chat_id}/", response_model=list[MessageSchema])
async def get_messages_for_chat(
    chat_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Возвращает сообщения чата и помечает входящие как прочитанные."""
    return await crud.list_chat_messages(
        session=session,
        chat_id=chat_id,
        user_id=user.id,
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
