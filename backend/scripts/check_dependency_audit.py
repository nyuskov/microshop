#!/usr/bin/env python3
"""Страж «в зависимостях появилась известная уязвимость».

`pip-audit` сверяет установленные пакеты с базой уязвимостей (OSV/PyPI). На
сегодня в окружении есть находки, которые просто так не закрыть: часть тянет
`starlette` (ограничен версией FastAPI), часть — инструменты разработки
(`black`, `mako`). Они зафиксированы в `pip-audit-baseline.json`, а проверка
падает только на НОВЫХ — как остальные стражи проекта (см. `docs/checks.md`).

Запуск из каталога `backend` (в том же окружении, что и тесты):

    poetry run python scripts/check_dependency_audit.py
    poetry run python scripts/check_dependency_audit.py --update-baseline

Нужен доступ в сеть: pip-audit ходит в базу уязвимостей.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

BASELINE = Path(__file__).resolve().parent.parent / "pip-audit-baseline.json"


def run_audit() -> list[dict]:
    """Возвращает зависимости из pip-audit (JSON), не падая на его коде выхода."""
    result = subprocess.run(
        [sys.executable, "-m", "pip_audit", "--progress-spinner", "off", "-f", "json"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        sys.stderr.write("Не удалось разобрать вывод pip-audit:\n")
        sys.stderr.write(result.stdout + result.stderr)
        raise SystemExit(2)
    if isinstance(payload, dict):
        return payload.get("dependencies", [])
    return payload


def findings(deps: list[dict]) -> dict[str, str]:
    """Ключ «пакет|идентификатор уязвимости» → критичность (для базы)."""
    found: dict[str, str] = {}
    for dep in deps:
        for vuln in dep.get("vulns") or []:
            key = f"{dep['name']}|{vuln['id']}"
            found[key] = str(vuln.get("fix_versions") or "нет исправления")
    return dict(sorted(found.items()))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="записать текущие находки в базу (осознанное принятие риска)",
    )
    args = parser.parse_args()

    found = findings(run_audit())
    if args.update_baseline:
        BASELINE.write_text(
            json.dumps(found, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"База обновлена: {BASELINE} ({len(found)} находок)")
        return 0

    known: dict[str, str] = {}
    if BASELINE.exists():
        known = json.loads(BASELINE.read_text(encoding="utf-8"))

    new = {key: value for key, value in found.items() if key not in known}
    if not new:
        print(f"Новых уязвимостей в зависимостях нет ({len(found)} известных).")
        return 0

    print("В зависимостях появились известные уязвимости:")
    for key, fix in sorted(new.items()):
        package, vuln_id = key.split("|", 1)
        print(f"  {package} — {vuln_id} (исправление: {fix})")
    print(
        "\nОбновите пакет или зафиксируйте риск осознанно:\n"
        "  poetry run python scripts/check_dependency_audit.py --update-baseline"
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
