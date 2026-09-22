"""Ищет русские строки в коде бэкенда, которые ещё не обёрнуты в t(...).

Зачем: серверные тексты должны переводиться (см. core/i18n.py). Скрипт не
меняет код — только показывает остаток, чтобы его можно было закрыть пачками.
Пропускает: docstring'и, комментарии, логи (logger.*), служебные строки в
alembic и в самих файлах переводов.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CYRILLIC = re.compile(r"[А-Яа-яЁё]")
SKIP_PARTS = {"__pycache__", ".mypy_cache", "alembic", "tests"}
SKIP_FILES = {"i18n.py", "i18n_en.py"}


def is_docstring(node: ast.Constant, parents: dict[int, ast.AST]) -> bool:
    parent = parents.get(id(node))
    if not isinstance(parent, ast.Expr):
        return False
    grand = parents.get(id(parent))
    if not isinstance(
        grand, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
    ):
        return False
    return bool(grand.body) and grand.body[0] is parent


def call_name(node: ast.Call) -> str:
    func = node.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return ""


def main() -> None:
    files = [
        path
        for path in ROOT.rglob("*.py")
        if not (SKIP_PARTS & set(path.parts)) and path.name not in SKIP_FILES
    ]
    total = 0
    for path in sorted(files):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        parents: dict[int, ast.AST] = {}
        for node in ast.walk(tree):
            for child in ast.iter_child_nodes(node):
                parents[id(child)] = node

        for node in ast.walk(tree):
            if not isinstance(node, ast.Constant) or not isinstance(node.value, str):
                continue
            if not CYRILLIC.search(node.value):
                continue
            if is_docstring(node, parents):
                continue

            parent = parents.get(id(node))
            # Уже переведено: t("…") / t("…", lang=…)
            if isinstance(parent, ast.Call) and call_name(parent) == "t":
                continue
            # Логи — для разработчика, человеку не показываются.
            if isinstance(parent, ast.Call) and call_name(parent) in {
                "warning",
                "info",
                "error",
                "exception",
                "debug",
                "critical",
                "format",
            }:
                continue
            total += 1
            rel = path.relative_to(ROOT)
            print(f"{rel}:{node.lineno}: {node.value[:90]}")

    print(f"--- осталось строк: {total}", file=sys.stderr)


if __name__ == "__main__":
    main()
