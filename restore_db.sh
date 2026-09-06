#!/usr/bin/env bash
# Восстанавливает БД из дампа. ВНИМАНИЕ: текущие данные в БД будут перезаписаны
# (дамп сделан с ключом --clean, т.е. объекты сначала удаляются).
#
# Использование:
#   ./restore_db.sh                          # из db_dump/microshop_latest.sql
#   ./restore_db.sh <путь_к_дампу.sql>       # из конкретного файла
#
# Обычно отдельный restore не нужен: контейнер db сам восстанавливает
# db_dump/microshop_latest.sql при создании нового volume БД (после `down -v`).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

DB_NAME="${DB_NAME:-microshop}"
DB_USER="${DB_USER:-postgres}"
DUMP_FILE="${1:-$ROOT/db_dump/microshop_latest.sql}"

if [[ ! -f "$DUMP_FILE" ]]; then
    echo "!!! Не найден файл дампа: $DUMP_FILE" >&2
    echo "    Сначала создайте дамп: ./dump_db.sh" >&2
    exit 1
fi

# Если сервис db не запущен — поднимаем только его.
if ! docker compose ps --status running --services | grep -qx "db"; then
    echo "==> Сервис 'db' не запущен, поднимаю его..."
    docker compose up -d db
fi

echo "==> Ожидание готовности PostgreSQL..."
READY=""
for _ in $(seq 1 60); do
    if docker compose exec -T db pg_isready -U "$DB_USER" -d "$DB_NAME" -q; then
        READY=1
        break
    fi
    sleep 1
done
if [[ -z "$READY" ]]; then
    echo "!!! PostgreSQL не стал доступен за 60 секунд — восстановление отменено." >&2
    exit 1
fi

echo "==> Восстановление '$DB_NAME' из '$DUMP_FILE' ..."
docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
    < "$DUMP_FILE"

echo "==> Готово."
