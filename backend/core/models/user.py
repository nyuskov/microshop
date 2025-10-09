from typing import TYPE_CHECKING

from fastapi_users.db import (
    SQLAlchemyBaseUserTable,
    SQLAlchemyUserDatabase,
)
from sqlalchemy import LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .mixins import IdIntPkMixin

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from .post import Post
    from .profile import Profile


class User(IdIntPkMixin, SQLAlchemyBaseUserTable[int], Base):
    username: Mapped[str] = mapped_column(String(32), unique=True)
    hashed_password: Mapped[bytes] = mapped_column(LargeBinary(1024))
    posts: Mapped[list["Post"]] = relationship(back_populates="user")
    profile: Mapped["Profile"] = relationship(back_populates="user")

    @classmethod
    def get_db(cls, session: "AsyncSession"):
        return SQLAlchemyUserDatabase(session, cls)

    def __str__(self):
        return f"{self.__class__.__name__}(id={self.id}, username={
            self.username!r})"

    def __repr__(self):
        return str(self)
