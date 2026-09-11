"""Юнит-тесты разбора ссылок для превью (без БД и без сети).

Всё, что ходит в интернет, здесь не вызывается: проверяем разбор адреса, защиту
от SSRF (по литеральным IP и служебным именам — DNS для этого не нужен) и разбор
мета-тегов HTML. Сетевой код проверяется на встроенном HTML в тестах API.
"""

from core.link_preview import (
    domain_of,
    download_page,
    host_is_public,
    normalize_url,
    parse_preview,
)

# ---------------------------------------------------------------- адрес ссылки


def test_normalize_url_adds_scheme_and_drops_fragment() -> None:
    assert normalize_url("youtube.com/watch?v=abc#t=10") == (
        "https://youtube.com/watch?v=abc"
    )


def test_normalize_url_lowercases_host_and_keeps_query() -> None:
    assert normalize_url("https://WWW.Example.COM/Path?A=1") == (
        "https://www.example.com/Path?A=1"
    )


def test_normalize_url_adds_root_path() -> None:
    assert normalize_url("https://example.com") == "https://example.com/"


def test_normalize_url_rejects_unsupported_input() -> None:
    for value in (
        "",
        "   ",
        "not a link",
        "http://not a link/",
        "интересное-слово",
        "ftp://example.com/file",
        "javascript:alert(1)",
        "file:///etc/passwd",
        "mailto:user@example.com",
        "https://",
        # Логин с паролем в адресе — не ссылка, а попытка запутать.
        "https://user:pass@example.com/",
        # Нестандартный порт: через него можно щупать чужие сервисы.
        "http://example.com:6379/",
        # Слишком длинная ссылка.
        "https://example.com/" + "a" * 3000,
    ):
        assert normalize_url(value) is None, value


def test_normalize_url_keeps_ip_links() -> None:
    # Ссылка прямо на IP — законная (домена может и не быть).
    assert normalize_url("http://93.184.216.34/page") == "http://93.184.216.34/page"
    assert normalize_url("https://[2606:4700::1111]/") == "https://[2606:4700::1111]/"


def test_domain_of_strips_www() -> None:
    assert domain_of("https://www.kinopoisk.ru/film/1/") == "kinopoisk.ru"
    assert domain_of("https://youtube.com/watch?v=1") == "youtube.com"
    assert domain_of("not a url") is None


# ---------------------------------------------------------------- защита от SSRF


def test_public_hosts_allowed() -> None:
    assert host_is_public("8.8.8.8")
    assert host_is_public("1.1.1.1")
    assert host_is_public("2606:4700::1111")


def test_internal_hosts_blocked() -> None:
    for host in (
        "127.0.0.1",
        "0.0.0.0",
        "10.1.2.3",
        "192.168.1.10",
        "172.16.0.5",
        "169.254.169.254",  # метаданные облака
        "::1",
        "fc00::1",
        "fe80::1",
        "localhost",
        "api.local",
        "service.internal",
        "",
    ):
        assert not host_is_public(host), host


def test_download_refuses_internal_addresses_without_network() -> None:
    # Проверка адреса идёт ДО подключения, поэтому запрос не уходит в сеть и
    # возвращается быстро: внутренние адреса недоступны даже через редирект.
    for url in ("http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/"):
        assert download_page(url, timeout=0.5, max_bytes=1024, max_redirects=1) is None


# ---------------------------------------------------------------- разбор HTML


def test_parse_preview_reads_open_graph() -> None:
    html = """<!doctype html><html><head>
        <title>Из тега title</title>
        <meta property="og:title" content="  Видео на YouTube  ">
        <meta property="og:description" content="Описание
            в две строки">
        <meta property="og:site_name" content="YouTube">
        <meta property="og:image" content="/preview.jpg">
        <meta name="twitter:image" content="https://cdn.example.com/big.jpg">
    </head><body>шум</body></html>"""

    preview = parse_preview(
        html.encode("utf-8"), "https://www.youtube.com/watch?v=SOi0APxsdgE"
    )

    assert preview.title == "Видео на YouTube"
    assert preview.description == "Описание в две строки"
    assert preview.site_name == "YouTube"
    # Относительный адрес картинки достраивается до абсолютного.
    assert preview.image_url == "https://www.youtube.com/preview.jpg"


def test_parse_preview_falls_back_to_title_and_description() -> None:
    html = """<html><head><title>Pismo — мессенджер</title>
        <meta name="description" content="Обычное описание">
    </head><body></body></html>"""

    preview = parse_preview(html.encode("utf-8"), "https://pismo.space/")

    assert preview.title == "Pismo — мессенджер"
    assert preview.description == "Обычное описание"
    # Своего имени сайта нет — берём домен.
    assert preview.site_name == "pismo.space"
    assert preview.image_url is None


def test_parse_preview_handles_windows_1251() -> None:
    html = (
        '<html><head><meta charset="windows-1251">'
        '<meta property="og:title" content="Новости дня"></head></html>'
    ).encode("cp1251")

    preview = parse_preview(html, "https://example.ru/news")

    assert preview.title == "Новости дня"


def test_parse_preview_drops_unsafe_image_url() -> None:
    html = """<html><head><meta property="og:title" content="X">
        <meta property="og:image" content="http://127.0.0.1:8080/private.png">
    </head></html>"""

    preview = parse_preview(html.encode("utf-8"), "https://example.com/")

    assert preview.title == "X"
    assert preview.image_url is None


def test_parse_preview_without_meta_gives_empty_card() -> None:
    preview = parse_preview(b"<html><body>no meta</body></html>", "https://e.com/")

    assert preview.title is None
    assert preview.description is None
    assert preview.image_url is None
    assert preview.site_name == "e.com"
