from typing import TYPE_CHECKING

from fastapi_users.db import (
    SQLAlchemyBaseUserTable,
    SQLAlchemyUserDatabase,
)
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .mixins import IdIntPkMixin

# Импортируем ассоциативную таблицу из group.py
from .group import user_group_association_table

if TYPE_CHECKING:
    from .post import Post
    from .profile import Profile
    from .group import Group


class User(IdIntPkMixin, SQLAlchemyBaseUserTable[int], Base):
    username: Mapped[str] = mapped_column(String(32), unique=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    posts: Mapped[list["Post"]] = relationship(back_populates="user")
    profile: Mapped["Profile"] = relationship(back_populates="user")

    groups: Mapped[list["Group"]] = relationship(
        "Group",
        secondary=user_group_association_table,
        back_populates="users",
    )

    def __str__(self):
        return f"{self.__class__.__name__}(id={self.id}, username={self.username!r})"

    def __repr__(self):
        return str(self)
