"""Кэш карточек внешних ссылок (превью ссылок в сообщениях).

Ходить по чужой ссылке — дорого и не всегда возможно (сайт лежит, отвечает
минуту, отдаёт то же самое). Поэтому результат запоминается по адресу: одна
строка на URL, с отметкой времени. Успешную карточку держим неделю, неудачную —
час (сайт мог «отлежаться»).

``image_url`` — ссылка на НАШ файл в общем каталоге media (картинку мы скачали
к себе), либо ``None``, если картинки у страницы нет.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from core.db_types import EncryptedText

from .base import Base
from .mixins import IdIntPkMixin


class LinkPreview(IdIntPkMixin, Base):
    """Карточка ссылки: заголовок, описание, домен и картинка."""

    __tablename__ = "link_previews"

    url: Mapped[str] = mapped_column(String(2048), unique=True, index=True)
    # Заголовок/описание/имя сайта — текст чужой страницы, он связан с тем, что
    # человек пересылал в переписке, поэтому шифруется. Сам адрес (`url`)
    # остаётся открытым: это ключ кэша (уникальный индекс) и по нему идёт поиск.
    title: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    description: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    site_name: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    #: Удалось ли собрать карточку (неудачи тоже кэшируем, чтобы не долбить сайт).
    ok: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(id={self.id}, url={self.url!r})"
