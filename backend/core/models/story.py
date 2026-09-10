"""Истории (статусы): медиа на 24 часа.

Аналог Telegram Stories / WhatsApp Status. Автор публикует фото или видео с
подписью, история живёт ``STORY_TTL_HOURS`` часов и доступна другим
пользователям в ленте историй; просмотры фиксируются поштучно (``StoryView``),
чтобы показывать «свои» непросмотренными и считать количество просмотров.

Срок жизни — не «фоновая» задача, а условие выборки (``expires_at > now()``),
поэтому истёкшие истории перестают показываться сразу; ночная задача удаляет их
из БД, а файлы подбирает общая очистка media по отсутствию ссылок.
"""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .mixins import IdIntPkMixin

if TYPE_CHECKING:
    from .user import User


class Story(IdIntPkMixin, Base):
    """Одна публикация: медиа + подпись + срок жизни."""

    __tablename__ = "stories"
    __table_args__ = (
        # Лента выбирает только непросроченные истории, автор — свои по времени.
        Index("ix_stories_expires_at", "expires_at"),
        Index("ix_stories_user_created", "user_id", "created_at"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    caption: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Медиа лежит в общем каталоге media; в БД только ссылка и метаданные
    # (как у вложений сообщений — их же учитывает квота хранилища).
    media_url: Mapped[str] = mapped_column(String(255))
    media_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    media_size: Mapped[int | None]

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    # Момент, после которого история не показывается (создание + 24 ч).
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    user: Mapped["User"] = relationship()
    views: Mapped[list["StoryView"]] = relationship(
        back_populates="story",
        cascade="all, delete-orphan",
    )


class StoryView(Base):
    """Кто и когда посмотрел историю.

    Нужно, чтобы: своя история оставалась непросмотренной до первого чужого
    открытия, а лента считала «есть новое» для каждого пользователя отдельно.
    """

    __tablename__ = "story_views"
    __table_args__ = (
        UniqueConstraint("story_id", "viewer_id", name="uq_story_views_story_viewer"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    story_id: Mapped[int] = mapped_column(
        ForeignKey("stories.id", ondelete="CASCADE"), index=True
    )
    viewer_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    viewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    story: Mapped["Story"] = relationship(back_populates="views")
