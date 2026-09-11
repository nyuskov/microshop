"""Схемы предпросмотра ссылок."""

from pydantic import BaseModel, Field

from core.link_preview import domain_of
from core.models import LinkPreview


class LinkPreviewRequest(BaseModel):
    """Ссылка из сообщения, для которой нужна карточка."""

    url: str = Field(min_length=4, max_length=2048)


class LinkPreviewSchema(BaseModel):
    """Карточка ссылки для клиента.

    ``ok=False`` — карточку собрать не удалось (сайт недоступен, отдал не HTML
    или на странице нет ни заголовка, ни описания, ни картинки). Клиент в этом
    случае просто не показывает карточку.

    ``image_url`` — путь к НАШЕМУ файлу (``/media/...``), а не чужой адрес:
    картинку скачивает сервер, клиент ходит только к нам.
    """

    url: str
    ok: bool
    title: str | None = None
    description: str | None = None
    site_name: str | None = None
    image_url: str | None = None
    domain: str | None = None


def preview_to_schema(row: LinkPreview) -> LinkPreviewSchema:
    """Превращает строку кэша в ответ API (плюс домен для подписи)."""
    return LinkPreviewSchema(
        url=row.url,
        ok=row.ok,
        title=row.title,
        description=row.description,
        site_name=row.site_name,
        image_url=row.image_url,
        domain=domain_of(row.url),
    )
