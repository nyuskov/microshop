#!/usr/bin/env python3
"""Страж контракта API: схема OpenAPI в репозитории должна быть актуальной.

Схема FastAPI (`app.openapi()`) детерминирована (ключи сортируются, порядок
маршрутов стабилен), поэтому её можно хранить снимком — `backend/openapi.json`.
Любая правка контракта (новое поле, изменённый тип, новый маршрут) меняет файл
и видна в ревью, а фронтенд генерирует из него свои типы:

    cd frontend && node_modules/.bin/openapi-typescript ../backend/openapi.json \\
        -o src/types/generated.ts

Проверка падает, если схема разошлась со снимком — значит, контракт изменили, а
снимок не обновили (и фронтенд об этом не узнает).

Запуск из каталога `backend`:

    poetry run python scripts/check_openapi_snapshot.py
    poetry run python scripts/check_openapi_snapshot.py --update
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SNAPSHOT = BASE_DIR / "openapi.json"


def render_schema() -> str:
    """Схема приложения в стабильном виде (ключи отсортированы, отступ 2)."""
    # `main` лежит в корне backend, а запускают скрипт из этого каталога.
    sys.path.insert(0, str(BASE_DIR))
    from main import app  # noqa: E402 — импорт после правки sys.path

    schema = app.openapi()
    return json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--update",
        action="store_true",
        help="перезаписать снимок текущей схемой (осознанное изменение контракта)",
    )
    args = parser.parse_args()

    rendered = render_schema()
    if args.update:
        SNAPSHOT.write_text(rendered, encoding="utf-8")
        print(f"Снимок схемы обновлён: {SNAPSHOT}")
        return 0

    if not SNAPSHOT.exists():
        print(
            "Нет снимка схемы: backend/openapi.json. Создайте его с --update.",
            file=sys.stderr,
        )
        return 1

    if SNAPSHOT.read_text(encoding="utf-8") != rendered:
        print(
            "Схема API разошлась со снимком backend/openapi.json.\n"
            "Если контракт изменили осознанно — обновите снимок и типы фронтенда:\n"
            "  cd backend && poetry run python"
            " scripts/check_openapi_snapshot.py --update\n"
            "  cd frontend && node_modules/.bin/openapi-typescript"
            " ../backend/openapi.json -o src/types/generated.ts"
        )
        return 1

    print("Схема API совпадает со снимком.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
