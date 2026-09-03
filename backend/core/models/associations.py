from __future__ import annotations
from sqlalchemy import Column, ForeignKey, Integer, Table
from .base import Base

# Ассоциативная таблица для связи many-to-many между User и Chat
user_chat_association_table = Table(
    "chat_user_association",
    Base.metadata,
    Column(
        "chat_id",
        Integer,
        ForeignKey("chats.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "user_id",
        Integer,
        ForeignKey("user.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)
