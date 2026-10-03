#!/usr/bin/env python3
"""Страж «модель изменили — миграцию не написали».

`alembic check` сравнивает метаданные моделей (`core/models`) со схемой БД. В
проекте есть расхождения, которые autogenerate не умеет описать: индексы и
уникальные ограничения с именами из ручных миграций, комментарии колонок,
`ondelete` у внешних ключей. Они разбираются один раз и лежат в базе
`alembic-drift-baseline.txt`.

Проверка падает только на НОВЫХ расхождениях — как остальные стилевые стражи
(`frontend/scripts/check-tokens.mjs` и т.п., см. `docs/checks.md`). Так реальная
правка модели без миграции (новая таблица, колонка, смена nullable) сразу видна,
а известный шум не мешает.

Запуск — из каталога `backend` (как и `alembic`), БД должна быть на последней
ревизии (`alembic upgrade head`):

    python scripts/check_migration_drift.py
    python scripts/check_migration_drift.py --update-baseline
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

BASELINE = Path(__file__).resolve().parent.parent / "alembic-drift-baseline.txt"
# Префикс строки лога alembic: `INFO  [alembic.autogenerate.compare] Detected …`.
MARKER = "Detected "
# Сообщение о том, что БД отстала от ревизий — это ошибка окружения, а не шум.
STALE_DB = "Target database is not up to date"
# Информационные строки рефлексии: alembic сообщает, что принял owned-последовательность
# за SERIAL. Это не расхождение со схемой, и в разных прогонах их набор плавает.
NOISE = ("assuming SERIAL and omitting",)


def run_alembic_check() -> str:
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "check"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=os.environ.copy(),
    )
    return result.stdout


def detected_lines(output: str) -> list[str]:
    """Оставляет только сами расхождения, без времени и имени логгера."""
    lines = []
    for raw in output.splitlines():
        index = raw.find(MARKER)
        if index == -1:
            continue
        line = raw[index:].strip()
        if any(noise in line for noise in NOISE):
            continue
        lines.append(line)
    return sorted(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="записать текущие расхождения в базу (осознанное изменение)",
    )
    args = parser.parse_args()

    output = run_alembic_check()
    if STALE_DB in output:
        print(
            "БД не на последней ревизии — сначала `alembic upgrade head`",
            file=sys.stderr,
        )
        print(output, file=sys.stderr)
        return 1

    current = detected_lines(output)
    if args.update_baseline:
        BASELINE.write_text(
            "\n".join(current) + ("\n" if current else ""), encoding="utf-8"
        )
        print(f"База обновлена: {BASELINE} ({len(current)} расхождений)")
        return 0

    known = []
    if BASELINE.exists():
        known = [
            line for line in BASELINE.read_text(encoding="utf-8").splitlines() if line
        ]

    new = [line for line in current if line not in known]
    if not new:
        print(f"Дрейфа модели и миграций нет ({len(current)} известных расхождений).")
        return 0

    print("Модель изменили без миграции — новые расхождения со схемой БД:")
    for line in new:
        print(f"  {line}")
    print(
        "\nЕсли это осознанно и уже есть миграция — просто не должно быть."
        " Если расхождение ложное (autogenerate не умеет описать), зафиксируйте базу:\n"
        "  python scripts/check_migration_drift.py --update-baseline"
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
