from fastapi import APIRouter, Depends
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


@router.post("/", response_model=MessageSchema)
async def create_new_message(
    message: MessageCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Отправляет сообщение в чат от имени текущего пользователя."""
    return await crud.create_message(
        session=session,
        chat_id=message.chat_id,
        text=message.text,
        user_id=user.id,
    )


@router.get("/{chat_id}/", response_model=list[MessageSchema])
async def get_messages_for_chat(
    chat_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Возвращает сообщения чата для его участника."""
    return await crud.get_messages_by_chat_id(
        session=session,
        chat_id=chat_id,
        user_id=user.id,
    )
