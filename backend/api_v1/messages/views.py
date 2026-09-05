from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.messages import crud
from api_v1.messages.schemas import Message as MessageSchema
from api_v1.messages.schemas import MessageCreate
from core.models import db_helper

router = APIRouter(
    prefix="/messages",
    tags=["Messages"],
)


@router.post("/", response_model=MessageSchema)
async def create_new_message(
    message: MessageCreate,
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    return await crud.create_message(
        session=session, message_create=message.model_dump()
    )


@router.get("/{chat_id}/", response_model=list[MessageSchema])
async def get_messages_for_chat(
    chat_id: int,
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    return await crud.get_messages_by_chat_id(session=session, chat_id=chat_id)
