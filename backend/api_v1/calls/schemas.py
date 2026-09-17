"""Pydantic-схемы истории звонков."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from api_v1.chats.schemas import ChatUserSchema


class CallHistoryItem(BaseModel):
    """Одна запись о звонке (системное сообщение `kind='call'`)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    chat_id: int
    # Собеседник личного чата; None — аккаунт удалён, клиент покажет заглушку.
    peer: ChatUserSchema | None = None
    # Звонок: "audio" или "video".
    call_kind: str = "audio"
    # Исход: completed / missed / declined (см. _persist_call_record).
    call_state: str = "completed"
    # Длительность разговора в секундах (0 — не разговаривали).
    call_duration: int = 0
    timestamp: datetime
    # Звонил ли сам человек: у входящего пропущенного кнопка — «Перезвонить».
    outgoing: bool = False


class CallHistoryResponse(BaseModel):
    """Страница истории звонков: записи и сколько их всего."""

    items: list[CallHistoryItem] = []
    total: int = 0
