from sqlalchemy import Column, Integer, String, Table, ForeignKey
from sqlalchemy.orm import relationship
from .base import Base

# Ассоциативная таблица для связи многие-ко-многим
user_group_association_table = Table(
    "user_group",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("user.id"), primary_key=True),
    Column("group_id", Integer, ForeignKey("group.id"), primary_key=True),
)


class Group(Base):
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, index=True, nullable=False)
    description = Column(String, nullable=True)

    # Связь с пользователями
    users = relationship(
        "User",
        secondary=user_group_association_table,
        back_populates="groups",
    )
