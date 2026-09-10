"""Скачивает шрифты и собирает локальный fonts.css.

Шрифтов несколько — по назначению:

* **Roboto** — основной текст интерфейса (сообщения, списки, кнопки).
* **Golos Text** — заголовки и названия (современный шрифт с хорошей кириллицей,
  выглядит «свежее» системного Roboto).
* **Roboto Mono** — цифры: код из SMS/Telegram, номер телефона, таймеры звонка и
  записи (моноширинные цифры не «прыгают» при вводе и отсчёте).

Хостим сами: в РФ fonts.googleapis.com доступен не всегда, а PWA должна работать
без внешних загрузок. Оставляем только наборы, нужные приложению (кириллица +
латиница), unicode-range сохраняем из официального CSS.

Запуск: python3 frontend/scripts/fetch_font.py
"""

import pathlib
import re
import sys
import urllib.request

FRONTEND = pathlib.Path(__file__).resolve().parent.parent
FONTS_DIR = FRONTEND / "src/assets/fonts"
OUT_CSS = FRONTEND / "src/assets/fonts.css"
UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
# Роль шрифта → (фамилия в Google Fonts, веса, префикс файлов).
FAMILIES = [
    ("Roboto", "Roboto:wght@300;400;500;700", "roboto"),
    ("Golos Text", "Golos+Text:wght@500;600;700", "golos"),
    ("Roboto Mono", "Roboto+Mono:wght@400;500", "roboto-mono"),
]
# Наборы символов: кириллица и латиница (остальное приложению не нужно).
# cyrillic-ext (церковнославянские и исторические знаки) приложению не нужен.
KEEP = ("cyrillic", "latin-ext", "latin")


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read()


def css_url(spec: str) -> str:
    return (
        "https://fonts.googleapis.com/css2"
        f"?family={spec}&display=swap&subset=cyrillic,latin"
    )


def main() -> int:
    FONTS_DIR.mkdir(parents=True, exist_ok=True)
    out: list[str] = [
        "/* Шрифты приложения (файл сгенерирован scripts/fetch_font.py).",
        "   Roboto — основной текст, Golos Text — заголовки, Roboto Mono — цифры.",
        "   Наборы: кириллица + латиница; unicode-range из официального CSS, поэтому",
        "   браузер грузит только то, что реально нужно странице. */",
        "",
    ]

    for family, spec, prefix in FAMILIES:
        css = fetch(css_url(spec)).decode("utf-8")
        blocks = re.findall(r"/\*\s*([a-z-]+)\s*\*/\s*(@font-face\s*\{[^}]*\})", css)
        if not blocks:
            print(f"не разобрал ответ Google Fonts для {family}", file=sys.stderr)
            return 1

        out.append(f"/* ---------- {family} ---------- */")
        out.append("")
        for subset, block in blocks:
            if subset not in KEEP:
                continue
            match = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", block)
            if not match:
                continue
            # Шрифт вариативный: один файл на набор для всех весов, поэтому имя
            # даём по набору (одинаковые блоки ссылаются на один файл).
            name = f"{prefix}-{subset}.woff2"
            target = FONTS_DIR / name
            if not target.exists():
                target.write_bytes(fetch(match.group(1)))
            out.append(block.replace(match.group(1), f"./fonts/{name}").strip())
            out.append("")

    OUT_CSS.write_text("\n".join(out), encoding="utf-8")

    # Подчищаем файлы прежних запусков (у Google в имени хеш, он меняется).
    for stale in FONTS_DIR.glob("KFO*.woff2"):
        stale.unlink()
    for stale in FONTS_DIR.glob("*-cyrillic-ext.woff2"):
        stale.unlink()

    for family, _spec, prefix in FAMILIES:
        files = list(FONTS_DIR.glob(f"{prefix}-*.woff2"))
        total = sum(p.stat().st_size for p in files)
        print(f"{family}: файлов {len(files)}, {total / 1024:.0f} КБ")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
