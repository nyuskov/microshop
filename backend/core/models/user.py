from typing import TYPE_CHECKING

from sqlalchemy import Boolean, String, LargeBinary
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .post import Post
    from .profile import Profile


class User(Base):
    username: Mapped[str] = mapped_column(String(32), unique=True)
    hashed_password: Mapped[bytes] = mapped_column(LargeBinary,
                                                   server_default="Xx123456")
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default='TRUE',
        nullable=False,
    )
    posts: Mapped[list["Post"]] = relationship(back_populates="user")
    profile: Mapped["Profile"] = relationship(back_populates="user")

    def __str__(self):
        return f"{self.__class__.__name__}(id={self.id}, username={
            self.username!r})"

    def __repr__(self):
        return str(self)
