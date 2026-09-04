from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from .mixins import IdIntPkMixin, UserRelationMixin


class Profile(IdIntPkMixin, UserRelationMixin, Base):
    _user_id_unique = True
    _user_back_populates = "profile"

    first_name: Mapped[str | None] = mapped_column(String(40))
    last_name: Mapped[str | None] = mapped_column(String(40))
    bio: Mapped[str | None]
    birth_date: Mapped[str | None] = mapped_column(String(10))  # Format: YYYY-MM-DD
    language: Mapped[str | None] = mapped_column(String(10))  # e.g., 'en', 'ru'
    country: Mapped[str | None] = mapped_column(String(10))  # e.g., 'US', 'RU'
    notifications_enabled: Mapped[bool] = mapped_column(default=True)
    privacy_mode: Mapped[bool] = mapped_column(default=False)
