"""Рубильник технических работ из командной строки.

Обычно режим включают и выключают из приложения (админская панель →
«Технические работы», `api_v1/system/views.py`). Скрипт нужен на случай, когда
в приложение не зайти: сломалась сборка фронтенда, потерян пароль, миграция
легла так, что API не поднимается. Работает напрямую с БД, поэтому доступ к
серверу (или к БД) всё равно нужен.

Запуск (внутри контейнера web или worker):
    poetry run python -m scripts.maintenance status
    poetry run python -m scripts.maintenance on
    poetry run python -m scripts.maintenance on --message "Обновляем сервис"
    poetry run python -m scripts.maintenance off

Выключение дополнительно сбрасывает кэш режима в текущем процессе — на работу
уже запущенных процессов web это не влияет: они перечитают значение сами (кэш
живёт две секунды, см. core/maintenance.py).
"""

import argparse
import asyncio
import sys

from core import maintenance
from core.models import db_helper


async def _status() -> maintenance.MaintenanceState:
    async with db_helper.session_factory() as session:
        return await maintenance.read_state(session)


async def _set(*, enabled: bool, message: str | None) -> maintenance.MaintenanceState:
    async with db_helper.session_factory() as session:
        return await maintenance.write_state(session, enabled=enabled, message=message)


def _print_state(state: maintenance.MaintenanceState) -> None:
    if not state.enabled:
        print("Режим технических работ: ВЫКЛЮЧЕН")
        return
    since = state.since.isoformat(timespec="minutes") if state.since else "—"
    print(f"Режим технических работ: ВКЛЮЧЁН (с {since})")
    print(f"Текст для пользователей: {state.message}")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=("status", "on", "off"),
        help="status — показать состояние, on/off — включить или выключить.",
    )
    parser.add_argument(
        "--message",
        default=None,
        help="Текст, который увидят пользователи (только для on).",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    if args.action == "status":
        state = asyncio.run(_status())
    else:
        state = asyncio.run(_set(enabled=args.action == "on", message=args.message))
    _print_state(state)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:  # pragma: no cover - ручной запуск
        sys.exit(130)
