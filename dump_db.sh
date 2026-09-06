#!/usr/bin/env bash
# Сохраняет дамп БД на хост (./db_dump).
#
# - db_dump/microshop_latest.sql          — актуальный дамп. Именно этот файл
#                                          автоматически восстанавливается, когда docker
#                                          создаёт volume БД заново (после `down -v`),
#                                          через /docker-entrypoint-initdb.d.
# - db_dump/archive/microshop_<дата>.sql  — архивированные копии (по одной на запуск).
#
# Использование:
#   ./dump_db.sh           # снять дамп текущей БД (при необходимости поднимет сервис db)
#
# Переменные окружения (необязательно):
#   DB_NAME, DB_USER, DUMP_DIR

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

DB_NAME="${DB_NAME:-microshop}"
DB_USER="${DB_USER:-postgres}"
DUMP_DIR="${DUMP_DIR:-$ROOT/db_dump}"
ARCHIVE_DIR="$DUMP_DIR/archive"
LATEST="$DUMP_DIR/microshop_latest.sql"

mkdir -p "$DUMP_DIR" "$ARCHIVE_DIR"

# Если сервис db не запущен — поднимаем только его, чтобы снять актуальные данные.
if ! docker compose ps --status running --services | grep -qx "db"; then
    echo "==> Сервис 'db' не запущен, поднимаю его..."
    docker compose up -d db
fi

# Ждём готовности PostgreSQL (max ~60 c).
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
    echo "!!! PostgreSQL не стал доступен за 60 секунд — дамп отменён." >&2
    exit 1
fi

# Защита от «пустого» дампа: если в БД ещё нет таблиц (свежий volume, миграции
# не применялись) — не затираем прошлый хороший дамп.
TABLES="$(docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")"
if [[ "${TABLES:-0}" -eq 0 ]]; then
    echo "!! В БД '$DB_NAME' нет таблиц (свежая/пустая) — дамп не создаю,"
    echo "   прежний файл '$LATEST' сохранён."
    exit 0
fi

echo "==> Снятие дампа базы '$DB_NAME'..."
docker compose exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" \
    --clean --if-exists --format=plain > "$LATEST"

STAMP="$(date +%Y%m%d_%H%M%S)"
cp "$LATEST" "$ARCHIVE_DIR/${DB_NAME}_${STAMP}.sql"

echo "==> Готово:"
echo "    последний дамп : $LATEST"
echo "    архив          : $ARCHIVE_DIR/${DB_NAME}_${STAMP}.sql"
