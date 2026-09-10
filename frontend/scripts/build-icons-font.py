#!/usr/bin/env python3
"""Собирает урезанный шрифт иконок: только те лигатуры, что реально используются.

Полный Material Symbols Rounded весит ~5 МБ (4200 лигатур) — для мобильного это
слишком много, поэтому из официального файла оставляем лишь нужные иконки и
буквы, из которых состоят их названия.

Тонкость: имя лигатуры не всегда равно имени глифа — у части иконок есть
«легаси» псевдонимы (`phone_android` → глиф `mobile_2`, `help_outline` → `help`,
`delete_outline` → `delete`, `insert_drive_file` → `note`). Поэтому карта
«название → глиф» строится из таблицы GSUB (лигатуры), а не из списка глифов.

Имена иконок собираются из src так же, как их видит шаблон: `name="…"`,
`:name="…"`, `icon: '…'`, возвраты хелперов вида fileIcon().

Запуск (нужны fonttools + brotli):
    python3 -m venv .venv-fonts && .venv-fonts/bin/pip install fonttools brotli
    .venv-fonts/bin/python frontend/scripts/build-icons-font.py

Добавили новую иконку — прогоните скрипт ещё раз, иначе она отрендерится
текстом (имени не будет в шрифте).
"""

from __future__ import annotations

import pathlib
import re
import subprocess
import sys

FRONTEND = pathlib.Path(__file__).resolve().parent.parent
SRC = FRONTEND / "src"
SOURCE_FONT = (
    FRONTEND
    / "node_modules/@quasar/extras/material-symbols-rounded/web-font"
    / "sykg-zNym6YjUruM-QrEh7-nyTnjDwKNJ_190FjzaqkNCeE.woff2"
)
OUT_DIR = SRC / "assets/fonts"
OUT_FONT = OUT_DIR / "material-symbols-rounded-subset.woff2"

# Иконки, которые задаются динамически (состояния Quasar, варианты выбора) —
# держим их в шрифте, чтобы не пересобирать его из-за одной иконки.
EXTRA = {
    "arrow_drop_down",
    "arrow_drop_up",
    "cancel",
    "clear",
    "cloud_upload",
    "date_range",
    "first_page",
    "keyboard_arrow_down",
    "keyboard_arrow_left",
    "keyboard_arrow_right",
    "keyboard_arrow_up",
    "last_page",
    "menu",
    "menu_open",
    "navigation",
    "refresh",
    "skip_next",
    "skip_previous",
    "star",
    "undo",
    "unfold_more",
    "chevron_left",
    "chevron_right",
    "visibility",
    "visibility_off",
    "expand_less",
    "expand_more",
}

# Строки, которые похожи на имена иконок, но ими не являются.
# Сюда попадает всё, что вытаскивают эвристики (тернарники вида `? 'x' : 'y'`,
# значения CSS `visible/hidden`), но именами иконок не является.
JUNK = {
    "in",
    "out",
    "png",
    "jpg",
    "jpeg",
    "webm",
    "mp4",
    "ogg",
    "action",
    "icon",
    "fade",
    "text",
    "audio",
    "video",
    "dark",
    "smooth",
    "auto",
    "member",
    "admin",
    "denied",
    "granted",
    "disabled",
    "unsupported",
    "promote",
    "demote",
    "x",
    "y",
    "visible",
    "hidden",
    "section",
    "coarse",
    "fine",
}

DIGITS = {
    "zero": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
}


def used_icon_names() -> set[str]:
    names: set[str] = set()
    for path in sorted(list(SRC.rglob("*.vue")) + list(SRC.rglob("*.ts"))):
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r'\bname="([a-z0-9_]+)"', text):
            names.add(match.group(1))
        for attr in re.finditer(r':name="([^"]*)"', text):
            names.update(re.findall(r"[\'\"]([a-z0-9_]+)[\'\"]", attr.group(1)))
        for match in re.finditer(r'\bicon:\s*[\'"]([a-z0-9_]+)[\'"]', text):
            names.add(match.group(1))
        for match in re.finditer(r'\bicon\s*=\s*[\'"]([a-z0-9_]+)[\'"]', text):
            names.add(match.group(1))
        if "fileIcon" in text or "Icon" in path.name:
            for match in re.finditer(r'return\s+[\'"]([a-z0-9_]+)[\'"]', text):
                names.add(match.group(1))
            for match in re.finditer(
                r'\?\s*[\'"]([a-z0-9_]+)[\'"]\s*:\s*[\'"]([a-z0-9_]+)[\'"]', text
            ):
                names.add(match.group(1))
                names.add(match.group(2))
    return {n for n in names if n not in JUNK} | EXTRA


def ligature_map() -> dict[str, str]:
    """Название иконки (как её пишут в шаблоне) → имя глифа в шрифте."""
    from fontTools.ttLib import TTFont

    font = TTFont(SOURCE_FONT)
    mapping: dict[str, str] = {}

    def char_of(glyph_name: str) -> str:
        if glyph_name == "underscore":
            return "_"
        if glyph_name.startswith("digit_"):
            return DIGITS[glyph_name[len("digit_") :]]
        return glyph_name

    for lookup in font["GSUB"].table.LookupList.Lookup:
        for sub in lookup.SubTable:
            inner = getattr(sub, "ExtSubTable", sub)
            if inner.__class__.__name__ != "LigatureSubst":
                continue
            for first, ligature_set in inner.ligatures.items():
                for ligature in ligature_set:
                    text = char_of(first) + "".join(
                        char_of(c) for c in ligature.Component
                    )
                    mapping[text] = ligature.LigGlyph
    return mapping


def main() -> int:
    if not SOURCE_FONT.exists():
        print(f"нет исходного шрифта: {SOURCE_FONT}", file=sys.stderr)
        return 2

    names = sorted(used_icon_names())
    mapping = ligature_map()

    glyphs: list[str] = []
    unknown: list[str] = []
    for name in names:
        glyph = mapping.get(name)
        if glyph is None:
            unknown.append(name)
        else:
            glyphs.append(glyph)

    if unknown:
        print("нет в шрифте (проверьте имена):", ", ".join(unknown), file=sys.stderr)
        return 1

    letters = "".join(sorted({ch for name in names for ch in name}))
    text_file = pathlib.Path("/tmp/icons-subset-text.txt")
    text_file.write_text(letters, encoding="utf-8")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        "-m",
        "fontTools.subset",
        str(SOURCE_FONT),
        f'--glyphs={",".join(sorted(set(glyphs)))}',
        f"--text-file={text_file}",
        "--no-layout-closure",  # иначе лигатуры вернут все 4200 иконок
        "--layout-features=rlig,rclt",
        "--flavor=woff2",
        "--output-file=" + str(OUT_FONT),
    ]
    print(f"иконок в наборе: {len(names)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout[-1500:], result.stderr[-1500:], file=sys.stderr)
        return result.returncode

    size = OUT_FONT.stat().st_size
    print(
        f"готово: {OUT_FONT.relative_to(FRONTEND)} — {size / 1024:.0f} КБ "
        f"(исходник {SOURCE_FONT.stat().st_size / 1024 / 1024:.1f} МБ)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
