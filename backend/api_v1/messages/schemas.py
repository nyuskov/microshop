from pydantic import BaseModel


class MessageBase(BaseModel):
    text: str
    user_id: int
    chat_id: int


class MessageCreate(MessageBase):
    pass


class MessageUpdate(MessageBase):
    text: str | None = None


class MessageUpdatePartial(MessageBase):
    text: str | None = None


class Message(MessageBase):
    id: int
