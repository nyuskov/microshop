from __future__ import annotations

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Table, func

from .base import Base

# Роли участников группового чата (см. role в таблице ниже).
ROLE_CREATOR = "creator"
ROLE_ADMIN = "admin"
ROLE_MEMBER = "member"


# Ассоциативная таблица для связи many-to-many между User и Chat.
#
# Помимо членства хранит:
#   * role — роль участника в групповом чате:
#       creator — создатель группы (единственный, кто управляет админами),
#       admin   — админ (добавляет/исключает участников, меняет инфо группы),
#       member  — обычный участник.
#     Для приватных (парных) чатов и «Сохранённых сообщений» всегда "member".
#   * joined_at — когда пользователь стал участником чата.
#   * last_read_message_id — курсор прочтения участника в групповом чате
#     (последний прочитанный id сообщения). Используется для подсчёта
#     непрочитанных в группах (в личных чатах — отдельный флаг Message.is_read).
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
    Column(
        "role",
        String(16),
        nullable=False,
        server_default="member",
    ),
    Column(
        "joined_at",
        DateTime(timezone=False),
        nullable=False,
        server_default=func.now(),
    ),
    Column(
        "last_read_message_id",
        Integer,
        nullable=True,
    ),
)
