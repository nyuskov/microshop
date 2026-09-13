#!/usr/bin/env bash
# Полный перезапуск стека с сохранением данных через дамп.
# 1) Перед сбросом снимается дамп текущей БД в ./db_dump — данные не теряются.
# 2) down -v --rmi all (volume БД удаляется).
# 3) build + up. Так как volume БД теперь пуст, контейнер db при инициализации
#    автоматически восстановит данные из ./db_dump/microshop_latest.sql.
#
# Запуск из корня репозитория:  ./scripts/dev/entry.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "=== 1/4. Сохраняю дамп текущей БД ==="
./scripts/db/dump_db.sh

echo "=== 2/4. Полный сброс стека (down -v --rmi all) ==="
docker compose down -v --rmi all

echo "=== 3/4. Сборка образов ==="
docker compose build

echo "=== 4/4. Запуск (данные восстановятся из дампа) ==="
docker compose up
