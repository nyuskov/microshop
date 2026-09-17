"""Рисует стандартные стикеры-реакции и пишет их каталог.

Зачем генерировать, а не взять готовый набор: чужие наборы (Telegram и любые
другие) — это чужие картинки, их нельзя упаковывать в своё приложение (ни
правами, ни форматами: `.tgs`/`.webm` мы не проигрываем). Поэтому рисуем свои:
плашка в цвете акцента приложения и подпись — простые, читаемые в любом размере
стикеры-реакции («Ок», «Спасибо», «Привет»).

Что получается на выходе:

1. `frontend/public/stickers/reactions/<имя>.png` — 512×512, прозрачный фон.
   Раздаются как статические файлы приложения, поэтому сервер о них не знает:
   стикер уходит сообщением так же, как любой другой (клиент скачивает байты и
   отправляет их вложением с `sticker=true`).
2. `frontend/src/utils/standardStickers.ts` — каталог: паки и имена файлов.
   Файл генерируется, править руками не нужно.

Запуск (нужен Pillow и шрифт DejaVu с кириллицей):
    python3 frontend/scripts/build-standard-stickers.py
"""

from __future__ import annotations

import pathlib
from collections.abc import Iterable

from PIL import Image, ImageDraw, ImageFont

FRONTEND = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = FRONTEND / "public/stickers/reactions"
OUT_TS = FRONTEND / "src/utils/standardStickers.ts"

SIZE = 512
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]

#: Палитра: акцент приложения и два спокойных оттенка для разнообразия.
ACCENT = (46, 162, 94)
BLUE = (43, 135, 180)
AMBER = (200, 145, 25)
GREY = (109, 124, 140)

#: Паки: ключ, название и стикеры (имя файла, подпись, цвет плашки).
PACKS: list[tuple[str, str, list[tuple[str, str, tuple[int, int, int]]]]] = [
    (
        "reactions",
        "Реакции",
        [
            ("ok", "Ок", ACCENT),
            ("yes", "Да", ACCENT),
            ("no", "Нет", GREY),
            ("thanks", "Спасибо", BLUE),
            ("please", "Пожалуйста", BLUE),
            ("hello", "Привет", ACCENT),
            ("bye", "Пока", GREY),
            ("agree", "Согласен", ACCENT),
            ("funny", "Смешно", AMBER),
            ("love", "Люблю", (198, 60, 90)),
            ("sorry", "Извини", GREY),
            ("wait", "Минуту", AMBER),
            ("great", "Отлично", ACCENT),
            ("doubt", "Сомневаюсь", GREY),
            ("hug", "Обнимаю", (198, 60, 90)),
            ("congrats", "Поздравляю", AMBER),
        ],
    )
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    """Шрифт из системы (кириллица обязательна — иначе будут квадраты)."""
    for path in FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, size)
    raise SystemExit(
        "Нет шрифта с кириллицей: поставьте fonts-dejavu или fonts-liberation"
    )


def fit_font(text: str, max_width: int) -> ImageFont.FreeTypeFont:
    """Подбирает размер шрифта так, чтобы подпись влезла в плашку."""
    size = 150
    while size > 40:
        font = load_font(size)
        width = font.getbbox(text)[2] - font.getbbox(text)[0]
        if width <= max_width:
            return font
        size -= 6
    return load_font(40)


def draw_sticker(label: str, color: tuple[int, int, int]) -> Image.Image:
    """Стикер: скруглённая плашка во весь кадр и подпись по центру."""
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    # Небольшой отступ, чтобы стикер не «лип» к краям в ленте.
    margin = 16
    draw.rounded_rectangle(
        (margin, margin, SIZE - margin, SIZE - margin),
        radius=72,
        fill=(*color, 255),
    )
    font = fit_font(label, SIZE - 4 * margin - 40)
    box = draw.textbbox((0, 0), label, font=font)
    draw.text(
        (
            (SIZE - (box[2] - box[0])) / 2 - box[0],
            (SIZE - (box[3] - box[1])) / 2 - box[1],
        ),
        label,
        font=font,
        fill=(255, 255, 255, 255),
    )
    return image


def write_catalog(names: Iterable[tuple[str, str, str]]) -> None:
    """Пишет `src/utils/standardStickers.ts` по нарисованным файлам."""
    lines = [
        "/**",
        " * Стандартные стикеры приложения (файл сгенерирован `scripts/build-standard-stickers.py`).",
        " *",
        " * Это наши собственные картинки, а не чужой набор: они лежат в `public/` и",
        " * раздаются как статика, поэтому у сервера нет ни строк в БД, ни файлов в",
        " * `media/`. Отправка ничем не отличается от своих стикеров: клиент скачивает",
        " * байты и уходит сообщением с `sticker=true`.",
        " *",
        " * Удалить их нельзя (это часть приложения, а не библиотека человека), поэтому",
        " * в окне «Мои стикеры» их не видно — они всегда первые в панели.",
        " */",
        "",
        "export interface StandardSticker {",
        "  name: string",
        "  /** Путь к файлу в `public/` (готовый URL, без префикса API). */",
        "  url: string",
        "  /** Подпись для скринридера и подсказки. */",
        "  label: string",
        "}",
        "",
        "export interface StandardStickerPack {",
        "  key: string",
        "  title: string",
        "  stickers: StandardSticker[]",
        "}",
        "",
        "export const STANDARD_STICKER_PACKS: StandardStickerPack[] = [",
    ]
    for key, title, stickers in PACKS:
        lines.append("  {")
        lines.append(f"    key: '{key}',")
        lines.append(f"    title: '{title}',")
        lines.append("    stickers: [")
        for name, label, _ in stickers:
            lines.append(
                f"      {{ name: '{name}', url: '/stickers/{key}/{name}.png', "
                f"label: '{label}' }},"
            )
        lines.append("    ]")
        lines.append("  },")
    lines.append("]")
    lines.append("")
    OUT_TS.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written: list[tuple[str, str, str]] = []
    for key, _, stickers in PACKS:
        for name, label, color in stickers:
            image = draw_sticker(label, color)
            path = OUT_DIR / f"{name}.png"
            image.save(path, format="PNG", optimize=True)
            written.append((key, name, label))
            print(f"{path.relative_to(FRONTEND)}  {path.stat().st_size // 1024} КБ")
    write_catalog(written)
    print(f"Готово: {len(written)} стикеров, каталог {OUT_TS.relative_to(FRONTEND)}")


if __name__ == "__main__":
    main()
