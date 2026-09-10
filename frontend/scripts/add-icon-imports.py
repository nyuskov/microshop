"""Добавляет `import { icon }` в компоненты, где иконки превращает icon().

Явный импорт вместо глобального свойства: так компонент работает и в юнит-тестах
(там приложение не создаётся, и глобальных свойств попросту нет).
"""

from __future__ import annotations

import pathlib
import re

SRC = pathlib.Path(__file__).resolve().parent.parent / "src"
IMPORT = "import { icon } from '@/utils/icons'"
SCRIPT = re.compile(r"<script setup lang=\"ts\">\n")


def main() -> int:
    touched = 0
    for path in sorted(SRC.rglob("*.vue")):
        text = path.read_text(encoding="utf-8")
        # Только там, где icon() реально используется в шаблоне. Ищем по всему
        # файлу: у части компонентов внутри шаблона есть свои <template>, и
        # разрез по первому </template> их обрезает.
        if not re.search(r':name="\s*icon\(', text):
            continue
        if "from '@/utils/icons'" in text:
            continue
        match = SCRIPT.search(text)
        if not match:
            print(f"нет <script setup>: {path}", flush=True)
            continue
        insert_at = match.end()
        text = text[:insert_at] + IMPORT + "\n" + text[insert_at:]
        path.write_text(text, encoding="utf-8")
        touched += 1
    print(f"добавлено импортов: {touched}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
