"""Собирает CSS и урезанный шрифт для иконок Font Awesome.

Иконки в коде называются «логически» (`close`, `reply`, `videocam`), а какие
именно глифы рисовать — решает `src/utils/icons.ts` (этот скрипт читает его как
источник правды). Здесь мы:

1. берём мэппинг из `src/utils/icons.ts`;
2. проверяем, что каждая иконка есть в Font Awesome Free (иначе ошибаемся и
   перечисляем проблемные имена);
3. оставляем в шрифте только нужные глифы (полный FA Solid — 116 КБ, урезанный —
   в разы меньше);
4. пишем `src/assets/icons.css`: @font-face на урезанный шрифт, базовый класс
   `.pismo-ico` и правила `content` для каждой иконки.

Шрифт Quasar (Material Symbols Rounded) остаётся: внутренние элементы Quasar
(стрелки, «очистить» у полей и т.п.) по-прежнему рисуются им.

Запуск (нужны fonttools + brotli):
    python3 -m venv .venv-fonts && .venv-fonts/bin/pip install fonttools brotli
    .venv-fonts/bin/python frontend/scripts/build-icons-css.py
"""

from __future__ import annotations

import pathlib
import re
import subprocess
import sys

FRONTEND = pathlib.Path(__file__).resolve().parent.parent
MAP_TS = FRONTEND / "src/utils/icons.ts"
FA_CSS = FRONTEND / "node_modules/@quasar/extras/fontawesome-v7/fontawesome-v7.css"
FA_FONT = FRONTEND / "node_modules/@quasar/extras/fontawesome-v7/fa-solid-900.woff2"
OUT_CSS = FRONTEND / "src/assets/icons.css"
OUT_FONT = FRONTEND / "src/assets/fonts/fa-solid-subset.woff2"


def read_mapping() -> dict[str, str]:
    """Мэппинг «логическое имя → имя Font Awesome» из src/utils/icons.ts."""
    text = MAP_TS.read_text(encoding="utf-8")
    body = text.split("export const ICON_MAP", 1)[1]
    # Запятая после значения необязательна: у последней записи prettier её убирает.
    pairs = re.findall(r"^\s{2}([a-z0-9_]+):\s*'([a-z0-9-]+)',?$", body, re.MULTILINE)
    if not pairs:
        raise SystemExit("не разобрал ICON_MAP в src/utils/icons.ts")
    return dict(pairs)


def decode_css_char(value: str) -> str:
    """CSS-escape → символ.

    В Font Awesome 7 часть иконок — обычные символы Unicode (`--fa: "\\+"` —
    это плюс), часть — приватные коды (`\\f00d`). Понимаем оба вида.
    """
    if value.startswith("\\"):
        rest = value[1:]
        hex_match = re.match(r"^([0-9a-fA-F]{1,6})\s?", rest)
        if hex_match:
            return chr(int(hex_match.group(1), 16))
        return rest[0] if rest else ""
    return value[0] if value else ""


def read_codepoints() -> dict[str, str]:
    """«Имя Font Awesome → код символа» (шестнадцатеричный) из официального CSS."""
    css = FA_CSS.read_text(encoding="utf-8")
    found = re.findall(
        r'^\.fa-([a-z0-9-]+) \{\s*--fa:\s*"((?:\\.|[^"\\])*)";', css, re.MULTILINE
    )
    result: dict[str, str] = {}
    for name, raw in found:
        char = decode_css_char(raw)
        if char:
            result[name] = f"{ord(char):X}"
    return result


def main() -> int:
    mapping = read_mapping()
    codepoints = read_codepoints()
    print(f"иконок в мэппинге: {len(mapping)}, в Font Awesome: {len(codepoints)}")

    missing = sorted({fa for fa in mapping.values() if fa not in codepoints})
    if missing:
        print("нет в Font Awesome Free:", ", ".join(missing), file=sys.stderr)
        return 1

    # Уникальные символы шрифта (несколько логических имён могут давать один глиф).
    chars = sorted({codepoints[fa] for fa in mapping.values()})
    unicodes = ",".join(f"U+{code.upper()}" for code in chars)

    cmd = [
        sys.executable,
        "-m",
        "fontTools.subset",
        str(FA_FONT),
        f"--unicodes={unicodes}",
        "--layout-features=",
        "--no-layout-closure",
        "--flavor=woff2",
        f"--output-file={OUT_FONT}",
    ]
    subprocess.run(cmd, check=True)

    rules = []
    for name in sorted(mapping):
        rule = f".fa-{mapping[name]}"
        if rule in rules:
            continue
        rules.append(rule)
    css = [
        "/* Иконки интерфейса. ФАЙЛ СГЕНЕРИРОВАН: frontend/scripts/build-icons-css.py",
        " *",
        " * Логические имена в коде (`close`, `reply`, ...) превращает в классы",
        " * функция `icon()` из src/utils/icons.ts, а сами глифы берутся из Font",
        " * Awesome Free (только используемые — см. урезанный шрифт ниже).",
        " *",
        " * Добавили иконку в код — допишите её в ICON_MAP и прогоните скрипт,",
        " * иначе иконка отрендерится пустотой (имени не будет в CSS).",
        " */",
        "/* Резервный шрифт: внутренние элементы Quasar (стрелки, «очистить» у",
        " * полей и т.п.) и любое имя, которого нет в ICON_MAP, рисуются им.",
        " * Собирается скриптом build-icons-font.py (Material Symbols Rounded,",
        " * урезанный до используемых имён). */",
        "@font-face {",
        "  font-family: 'Material Symbols Rounded';",
        "  font-style: normal;",
        "  font-weight: 100 700;",
        "  font-display: block;",
        "  src: url('./fonts/material-symbols-rounded-subset.woff2') format('woff2');",
        "}",
        "@font-face {",
        "  font-family: 'Pismo Icons';",
        "  font-style: normal;",
        "  font-weight: 100 900;",
        "  font-display: block;",
        "  src: url('./fonts/fa-solid-subset.woff2') format('woff2');",
        "}",
        "",
        "/* База: класс `fa-solid` добавляет icon() (Quasar по префиксу fa-",
        " * понимает, что это список классов, а не имя лигатуры). */",
        ".fa-solid {",
        "  font-family: 'Pismo Icons';",
        "  font-weight: 900;",
        "  font-style: normal;",
        "  font-variant: normal;",
        "  line-height: 1;",
        "  display: inline-block;",
        "  speak: never;",
        "}",
        "",
    ]
    for rule in rules:
        name = rule[len(".fa-") :]
        # Пробел после escape обязателен: он завершает последовательность.
        css.append(f"{rule}::before {{\n  content: '\\{codepoints[name]} ';\n}}\n")
    OUT_CSS.write_text("\n".join(css), encoding="utf-8")

    size = OUT_FONT.stat().st_size / 1024
    print(
        f"иконок в CSS: {len(rules)}, шрифт: {size:.0f} КБ (было {FA_FONT.stat().st_size / 1024:.0f} КБ)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
