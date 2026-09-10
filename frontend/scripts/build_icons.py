"""Собирает CSS и урезанный шрифт для иконок Lucide.

Иконки в коде называются «логически» (`close`, `reply`, `videocam`), а какой
глиф рисовать — решает `src/utils/icons.ts` (этот скрипт читает его как источник
правды). Здесь мы:

1. берём мэппинг из `src/utils/icons.ts`;
2. сверяем его с набором Lucide (карта `codepoints.json` из пакета) и ошибаемся,
   перечисляя неизвестные имена;
3. режем шрифт Lucide до нужных глифов (полный — 281 КБ, урезанный — единицы КБ);
4. пишем `src/assets/icons.css`: @font-face, базовый класс `.icon-lucide` и
   правила `content` для каждой иконки.

Класс начинается с `icon-` не случайно: Quasar по префиксу понимает, что ему
передали СПИСОК КЛАССОВ, а не имя лигатуры — иначе он рисует значение текстом.

Резервный шрифт Material Symbols Rounded остаётся: им рисуются внутренние
элементы Quasar (стрелки, «очистить» у полей) и имена, которых нет в ICON_MAP.

Запуск (нужны fonttools + brotli):
    /tmp/fonts-venv/bin/python frontend/scripts/build-icons-css.py
"""

from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys

FRONTEND = pathlib.Path(__file__).resolve().parent.parent
MAP_TS = FRONTEND / "src/utils/icons.ts"
CACHE = FRONTEND / "node_modules/.cache/pismo-icons"
SOURCE_FONT = CACHE / "lucide.woff2"
CODEPOINTS = CACHE / "codepoints.json"
OUT_CSS = FRONTEND / "src/assets/icons.css"
OUT_FONT = FRONTEND / "src/assets/fonts/lucide-subset.woff2"


def read_mapping() -> dict[str, str]:
    """Мэппинг «логическое имя → имя иконки Lucide» из src/utils/icons.ts."""
    text = MAP_TS.read_text(encoding="utf-8")
    body = text.split("export const ICON_MAP", 1)[1]
    # Запятая после значения необязательна: у последней записи prettier её убирает.
    pairs = re.findall(r"^\s{2}([a-z0-9_]+):\s*'([a-z0-9-]+)',?$", body, re.MULTILINE)
    if not pairs:
        raise SystemExit("не разобрал ICON_MAP в src/utils/icons.ts")
    return dict(pairs)


def read_codepoints() -> dict[str, str]:
    """«Имя иконки Lucide → код символа» (шестнадцатеричный)."""
    data = json.loads(CODEPOINTS.read_text(encoding="utf-8"))
    return {name: f"{int(code):X}" for name, code in data.items()}


def main() -> int:
    if not SOURCE_FONT.exists() or not CODEPOINTS.exists():
        print(
            "нет сборки иконок в кэше — прогоните scripts/fetch_icons.py",
            file=sys.stderr,
        )
        return 2

    mapping = read_mapping()
    codepoints = read_codepoints()
    print(f"иконок в мэппинге: {len(mapping)}, в наборе Lucide: {len(codepoints)}")

    missing = sorted({name for name in mapping.values() if name not in codepoints})
    if missing:
        print("нет в Lucide:", ", ".join(missing), file=sys.stderr)
        return 1

    # Уникальные символы (несколько логических имён могут давать один глиф).
    chars = sorted({codepoints[name] for name in mapping.values()})
    unicodes = ",".join(f"U+{code}" for code in chars)

    subprocess.run(
        [
            sys.executable,
            "-m",
            "fontTools.subset",
            str(SOURCE_FONT),
            f"--unicodes={unicodes}",
            "--layout-features=",
            "--no-layout-closure",
            "--flavor=woff2",
            f"--output-file={OUT_FONT}",
        ],
        check=True,
    )

    used = sorted(set(mapping.values()))
    css = [
        "/* Иконки интерфейса. ФАЙЛ СГЕНЕРИРОВАН: frontend/scripts/build-icons-css.py",
        " *",
        " * Набор — Lucide (тонкий штрих, скруглённые концы). Логические имена в",
        " * коде (`close`, `reply`, ...) превращает в классы функция `icon()` из",
        " * src/utils/icons.ts, а глифы берутся из урезанного шрифта ниже.",
        " *",
        " * Класс начинается с `icon-` намеренно: по этому префиксу Quasar понимает,",
        " * что получил список классов, а не имя лигатуры (иначе рисует текстом).",
        " *",
        " * Добавили иконку в код — допишите её в ICON_MAP и прогоните скрипт,",
        " * иначе иконка отрендерится пустотой (имени не будет в CSS).",
        " */",
        "/* Резервный шрифт: внутренние элементы Quasar и имена, которых нет в",
        " * ICON_MAP, рисуются им (см. scripts/build-icons-font.py). */",
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
        "  font-weight: 400;",
        "  font-display: block;",
        "  src: url('./fonts/lucide-subset.woff2') format('woff2');",
        "}",
        "",
        "/* База: класс добавляет icon() */",
        ".icon-lucide {",
        "  font-family: 'Pismo Icons';",
        "  font-style: normal;",
        "  font-variant: normal;",
        "  line-height: 1;",
        "  display: inline-block;",
        "  speak: never;",
        "}",
        "",
    ]
    for name in used:
        # Пробел после escape обязателен: он завершает последовательность.
        css.append(
            f".icon-{name}::before {{\n  content: '\\{codepoints[name]} ';\n}}\n"
        )
    OUT_CSS.write_text("\n".join(css), encoding="utf-8")

    # Файл прежнего набора (Font Awesome) больше не нужен.
    for stale in (FRONTEND / "src/assets/fonts").glob("fa-solid-subset.woff2"):
        stale.unlink()

    print(
        f"иконок в CSS: {len(used)}, шрифт: {OUT_FONT.stat().st_size / 1024:.0f} КБ "
        f"(было {SOURCE_FONT.stat().st_size / 1024:.0f} КБ)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
