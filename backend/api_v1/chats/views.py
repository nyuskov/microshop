from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.chats import crud
from api_v1.chats.schemas import ChatCreate, Chat as ChatSchema
from core.models import db_helper

router = APIRouter(
    prefix="/chats",
    tags=["Chats"],
)


@router.post("/", response_model=ChatSchema)
async def create_new_chat(
    chat: ChatCreate,
    session: AsyncSession = Depends(db_helper.session_dependency),  # Исправлено
):
    new_chat = await crud.create_chat(session=session, chat_create=chat.model_dump())
    return new_chat


@router.get("/", response_model=list[ChatSchema])
async def get_all_chats(
    session: AsyncSession = Depends(db_helper.session_dependency),  # Исправлено
):
    chats = await crud.get_chats(session=session)
    return chats
