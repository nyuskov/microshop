from pydantic import BaseModel


class ChatBase(BaseModel):
    name: str


class ChatCreate(ChatBase):
    pass


class ChatUpdate(ChatBase):
    name: str | None = None


class ChatUpdatePartial(ChatBase):
    name: str | None = None


class Chat(ChatBase):
    id: int
    # Не включаем список пользователей и сообщений для упрощения
