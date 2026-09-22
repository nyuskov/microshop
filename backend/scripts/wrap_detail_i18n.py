"""Оборачивает русские тексты ошибок в t(...) и ставит импорт.

Зачем: серверные тексты (detail= в HTTPException, message= в служебных
ответах) должны переводиться на язык профиля — см. core/i18n.py.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGETS = ["api_v1", "core", "tasks", "main.py"]
SKIP_PARTS = {"tests", "__pycache__", "alembic"}

# detail="текст с кириллицей" / detail='текст' — БЕЗ f-префикса и без уже t(.
PATTERNS = [
    (re.compile(r'detail="([^"\\]*[А-Яа-яЁё][^"\\]*)"'), 'detail=t("\\1")'),
    (re.compile(r"detail='([^'\\]*[А-Яа-яЁё][^'\\]*)'"), "detail=t('\\1')"),
]

IMPORT_LINE = "from core.i18n import t"


def iter_files() -> list[Path]:
    out: list[Path] = []
    for target in TARGETS:
        path = ROOT / target
        if path.is_file():
            out.append(path)
            continue
        for file in path.rglob("*.py"):
            if SKIP_PARTS & set(file.parts):
                continue
            out.append(file)
    return sorted(out)


def insert_import(text: str) -> str:
    """Ставит импорт в шапку — сразу после блока импортов из core."""
    if IMPORT_LINE in text:
        return text
    lines = text.split("\n")
    depth = 0
    last_core = -1
    last_import = -1
    started = False
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("import ") or stripped.startswith("from "):
            started = True
        elif depth == 0:
            if started:
                break
            continue
        depth += line.count("(") - line.count(")")
        if depth <= 0:
            depth = 0
            last_import = index
            if line.startswith("from core"):
                last_core = index
    at = last_core if last_core >= 0 else last_import
    if at < 0:
        print(f"!!! не нашёл шапку импортов: {file}", file=sys.stderr)
        return text
    lines.insert(at + 1, IMPORT_LINE)
    return "\n".join(lines)


def main() -> None:
    changed: list[str] = []
    for file in iter_files():
        text = file.read_text(encoding="utf-8")
        if "detail=" not in text:
            continue
        new = text
        count = 0
        for pattern, repl in PATTERNS:

            def sub(match: re.Match[str]) -> str:
                nonlocal count
                count += 1
                return repl.replace("\\1", match.group(1))

            new = pattern.sub(sub, new)
        if count == 0:
            continue
        new = insert_import(new)
        if "--apply" in sys.argv:
            file.write_text(new, encoding="utf-8")
        changed.append(f"{file.relative_to(ROOT)}: {count}")
    print("\n".join(changed))
    print(f"--- файлов: {len(changed)}")


if __name__ == "__main__":
    main()
