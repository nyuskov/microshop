"""Предпросмотр внешних ссылок: «карточка ссылки» как в Telegram.

Когда в сообщении есть ссылка на сторонний сайт (например, на видео с YouTube),
мессенджер показывает под текстом карточку: заголовок, описание и картинку,
которые сайт отдаёт в мета-тегах Open Graph.

Здесь живёт самая опасная часть — сервер сам ходит по чужому адресу. Поэтому:

* пускаем только ``http``/``https`` и только на **публичные** адреса (защита от
  SSRF: ``127.0.0.1``, ``10.*``, ``169.254.*``, ``::1`` и прочие служебные сети
  отсекаются — и по имени хоста, и по всем DNS-адресам, включая редиректы);
* ограничиваем время ответа, объём страницы и число переходов;
* читаем только HTML (картинку — только настоящую картинку, по сигнатуре);
* ничего не исполняем: HTML разбирается стандартным парсером без скриптов.

Функции, которые ходят в сеть, синхронные — вызывать их нужно через
``asyncio.to_thread`` (см. ``api_v1/link_previews/views.py``).
"""

from __future__ import annotations

import http.client
import ipaddress
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser

from core.config import settings

#: Ссылки длиннее не бывает смысла ходить — и хранить её в кэше тоже.
MAX_URL_LENGTH = 2048

#: Порт в ссылке: только обычные для веба. Иначе через мессенджер можно было бы
#: щупать чужие сервисы (базы, админки) на нестандартных портах.
ALLOWED_PORTS = {80, 443}

#: Представляемся честно: сайт может по этому агенту отличить нашего робота.
BOT_USER_AGENT = "Mozilla/5.0 (compatible; PismoBot/1.0; +https://pismo.space)"

#: Типы, которые считаем «страницей».
HTML_CONTENT_TYPES = {"text/html", "application/xhtml+xml"}


@dataclass
class LinkPreviewData:
    """Разобранная карточка ссылки."""

    url: str
    title: str | None = None
    description: str | None = None
    site_name: str | None = None
    image_url: str | None = None


@dataclass
class DownloadedPage:
    """Что удалось скачать: итоговый адрес, тип и тело ответа."""

    url: str
    content_type: str
    body: bytes


def _is_ip_literal(host: str) -> bool:
    """IP-адрес прямо в ссылке (``93.184.216.34``, ``[2606:4700::1111]``)."""
    try:
        ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return False
    return True


def _valid_hostname(host: str) -> bool:
    """Похоже ли имя хоста на настоящее (без пробелов, «not a link» и прочего).

    ``urlsplit`` намеренно терпимый: он примет и ``https://not a link/``. Но
    ходить по такому адресу бессмысленно, а в кэше он занял бы место, поэтому
    проверяем имя сами: буквы/цифры/дефис в метках, длина метки до 63 символов.
    """
    if not host or len(host) > 253:
        return False
    if host.startswith(".") or host.endswith("."):
        return False
    labels = host.split(".")
    for label in labels:
        if not label or len(label) > 63:
            return False
        if label.startswith("-") or label.endswith("-"):
            return False
        if not all(
            char.isascii() and (char.isalnum() or char == "-") for char in label
        ):
            return False
    # Голое имя без точки (``localhost``, ``intranet``) — не публичный сайт.
    return len(labels) >= 2


def normalize_url(raw: str) -> str | None:
    """Приводит ссылку из сообщения к виду для запроса.

    ``None`` — если это не ссылка, а что-то, по чему нельзя ходить (нет домена,
    другой протокол, логин с паролем внутри адреса, нестандартный порт).
    Фрагмент (``#...``) отбрасываем: он не влияет на содержимое страницы, а в
    кэше давал бы дубли одного адреса.
    """
    value = (raw or "").strip()
    if not value or len(value) > MAX_URL_LENGTH:
        return None
    if "://" not in value:
        value = f"https://{value}"
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    if not parsed.hostname:
        return None
    if parsed.username or parsed.password:
        return None
    if port is not None and port not in ALLOWED_PORTS:
        return None
    # Домен — в нижнем регистре (адреса не чувствительны к регистру, а кэш — да).
    hostname = parsed.hostname.lower()
    if not (_is_ip_literal(hostname) or _valid_hostname(hostname)):
        return None
    # IPv6 в адресе пишется в квадратных скобках — urlunsplit их сам не вернёт.
    host_for_netloc = f"[{hostname}]" if ":" in hostname else hostname
    netloc = host_for_netloc if port is None else f"{host_for_netloc}:{port}"
    path = parsed.path or "/"
    return urllib.parse.urlunsplit(
        (parsed.scheme.lower(), netloc, path, parsed.query, "")
    )


def domain_of(url: str) -> str | None:
    """Домен ссылки для подписи в карточке ('' → None)."""
    try:
        hostname = urllib.parse.urlsplit(url).hostname
    except ValueError:
        return None
    if not hostname:
        return None
    return hostname.lower().removeprefix("www.")


def _is_public_ip(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Публичный ли адрес (не служебный). См. «is_global» в ipaddress."""
    return address.is_global


def host_is_public(host: str) -> bool:
    """Ведёт ли хост на публичный адрес.

    Проверяем и буквальный IP, и результат DNS: имя может указывать на
    ``127.0.0.1`` или на адрес внутри сети — так делаются SSRF-атаки.
    """
    if not host:
        return False
    candidate = host.strip().strip("[]").lower()
    if candidate in {"localhost", "localhost.localdomain"}:
        return False
    if candidate.endswith((".local", ".internal", ".localhost")):
        return False
    try:
        return _is_public_ip(ipaddress.ip_address(candidate))
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(candidate, None)
    except (socket.gaierror, UnicodeError, OSError):
        return False
    if not infos:
        return False
    for info in infos:
        try:
            address = ipaddress.ip_address(info[4][0])
        except ValueError:
            return False
        if not _is_public_ip(address):
            return False
    return True


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Отключает авто-переходы: их мы делаем сами, проверяя каждый новый адрес."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: N802
        return None


def _build_opener() -> urllib.request.OpenerDirector:
    """Открывалка ссылок: без авто-редиректов и, если задан, через прокси.

    Прокси нужен там, где сервер сам не может дойти до сайта (например,
    youtube.com с российского хостинга). Пустая настройка — ходим напрямую.
    """
    handlers: list[urllib.request.BaseHandler] = [_NoRedirectHandler()]
    proxy = (settings.link_preview_proxy_url or "").strip()
    if proxy:
        handlers.append(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    return urllib.request.build_opener(*handlers)


def download_page(
    url: str,
    *,
    timeout: float,
    max_bytes: int,
    max_redirects: int,
    content_types: set[str] | None = None,
    accept: str = "text/html,application/xhtml+xml",
) -> DownloadedPage | None:
    """Скачивает адрес, проверяя КАЖДЫЙ шаг (в т.ч. редиректы) — или ``None``.

    ``content_types`` — какие типы ответа принимаем (``None`` — любые).
    Тело читаем не больше ``max_bytes``: страница в несколько гигабайт не должна
    съесть память сервера.
    """
    opener = _build_opener()
    current = url
    for _ in range(max_redirects + 1):
        try:
            parsed = urllib.parse.urlsplit(current)
            port = parsed.port
        except ValueError:
            return None
        if parsed.scheme not in ("http", "https"):
            return None
        if port is not None and port not in ALLOWED_PORTS:
            return None
        if not host_is_public(parsed.hostname or ""):
            return None

        request = urllib.request.Request(
            current,
            headers={
                "User-Agent": BOT_USER_AGENT,
                "Accept": accept,
                "Accept-Language": "ru,en;q=0.8",
            },
        )
        try:
            with opener.open(request, timeout=timeout) as response:
                content_type = (
                    (response.headers.get("Content-Type") or "")
                    .split(";")[0]
                    .strip()
                    .lower()
                )
                if content_types is not None and content_type not in content_types:
                    return None
                body = response.read(max_bytes + 1)
                if len(body) > max_bytes:
                    # Обрезаем, а не отказываемся: нужные теги обычно в <head>.
                    body = body[:max_bytes]
                final_url = response.geturl() or current
                return DownloadedPage(final_url, content_type, body)
        except urllib.error.HTTPError as error:
            location = error.headers.get("Location") if error.headers else None
            if error.code in (301, 302, 303, 307, 308) and location:
                current = urllib.parse.urljoin(current, location)
                continue
            return None
        except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError):
            return None
    return None


def _decode_html(body: bytes) -> str:
    """Декодирует HTML с учётом charset из первых байт (win-1251 тоже бывает)."""
    match = re.search(rb"charset=[\"']?([\w\-]+)", body[:4096], re.IGNORECASE)
    if match:
        encoding = match.group(1).decode("ascii", "replace")
        try:
            return body.decode(encoding, errors="replace")
        except (LookupError, UnicodeError):
            pass
    return body.decode("utf-8", errors="replace")


def _clean_text(value: str | None, limit: int) -> str | None:
    """Сжимает пробелы и обрезает слишком длинное (заголовки бывают огромные)."""
    text = re.sub(r"\s+", " ", value or "").strip()
    text = "".join(char for char in text if char.isprintable())
    if not text:
        return None
    return text[:limit]


class _MetaParser(HTMLParser):
    """Достаёт ``<title>`` и мета-теги; скрипты и стили игнорируются по смыслу."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title_parts: list[str] = []
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self._in_title = True
            return
        if tag != "meta":
            return
        attributes = {name.lower(): (value or "") for name, value in attrs}
        key = (
            (attributes.get("property") or attributes.get("name") or "").strip().lower()
        )
        content = (attributes.get("content") or "").strip()
        # Первое значение выигрывает: дальше обычно дубли для других соцсетей.
        if key and content and key not in self.meta:
            self.meta[key] = content

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title_parts.append(data)


def parse_preview(body: bytes, page_url: str) -> LinkPreviewData:
    """Разбирает HTML страницы в карточку ссылки (без обращения к сети)."""
    parser = _MetaParser()
    try:
        parser.feed(_decode_html(body))
    except Exception:  # noqa: BLE001 - битый HTML не должен ронять запрос
        pass

    def pick(*keys: str) -> str | None:
        for key in keys:
            value = parser.meta.get(key)
            if value:
                return value
        return None

    title = pick("og:title", "twitter:title") or "".join(parser.title_parts)
    description = pick("og:description", "twitter:description", "description")
    site_name = pick("og:site_name") or domain_of(page_url)
    image = pick(
        "og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"
    )
    image_url = None
    if image:
        candidate = urllib.parse.urljoin(page_url, image.strip())
        # Картинку тоже будем скачивать сами — адрес должен быть безопасным.
        if normalize_url(candidate):
            image_url = candidate

    return LinkPreviewData(
        url=page_url,
        title=_clean_text(title, 300),
        description=_clean_text(description, 600),
        site_name=_clean_text(site_name, 120),
        image_url=image_url,
    )


def fetch_preview(
    url: str,
    *,
    timeout: float,
    max_bytes: int,
    max_redirects: int,
) -> LinkPreviewData | None:
    """Скачивает страницу и собирает карточку. ``None`` — если не получилось."""
    page = download_page(
        url,
        timeout=timeout,
        max_bytes=max_bytes,
        max_redirects=max_redirects,
        content_types=HTML_CONTENT_TYPES,
    )
    if page is None:
        return None
    preview = parse_preview(page.body, page.url)
    if not (preview.title or preview.description or preview.image_url):
        # Страница без единого осмысленного тега — карточка была бы пустой.
        return None
    return preview


def fetch_preview_image(
    url: str,
    *,
    timeout: float,
    max_bytes: int,
    max_redirects: int,
) -> tuple[bytes, str] | None:
    """Скачивает картинку превью.

    Возвращает ``(байты, mime)``. Тип проверяет по сигнатуре вызывающий код
    (``core/upload_guard.py``), здесь важно только ограничить размер и адреса.
    """
    page = download_page(
        url,
        timeout=timeout,
        max_bytes=max_bytes,
        max_redirects=max_redirects,
        content_types=None,
        accept="image/*",
    )
    if page is None or not page.body:
        return None
    content_type = page.content_type or "application/octet-stream"
    if not content_type.startswith("image/"):
        return None
    return page.body, content_type
