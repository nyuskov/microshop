#!/usr/bin/env bash
# Устанавливает в crontab пользователя задачу ежедневного дампа БД (по умолчанию
# в 03:00) — вызывается ./cron_dump_db.sh (который запускает ./dump_db.sh,
# пишет лог и ограничивает число архивных копий).
#
# Повторный запуск безопасен: строка с маркером "# microshop-db-backup"
# заменяется на новую (дубликатов не появляется).
#
# Использование:
#   ./install_cron_backup.sh                    # ежедневно в 03:00
#   CRON_SCHEDULE='0 */6 * * *' ./install_cron_backup.sh   # каждые 6 часов
#
# Удаление задачи:
#   crontab -l | grep -v '# microshop-db-backup' | crontab -

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

MARKER="# microshop-db-backup"
CRON_SCHEDULE="${CRON_SCHEDULE:-0 3 * * *}"

if ! command -v crontab >/dev/null 2>&1; then
    echo "!!! crontab не найден. Установите cron (например: sudo apt install cron)." >&2
    exit 1
fi

# Путь может содержать пробелы/не-ASCII символы — оборачиваем в одинарные кавычки.
ESCAPED_ROOT="$(printf '%s' "$ROOT" | sed "s/'/'\\\\''/g")"
CRON_LINE="$CRON_SCHEDULE $MARKER cd '$ESCAPED_ROOT' && ./cron_dump_db.sh"

CURRENT="$(crontab -l 2>/dev/null || true)"
# Убираем прежние строки с маркером и пустые строки.
FILTERED="$(printf '%s\n' "$CURRENT" | grep -v -F "$MARKER" | sed '/^[[:space:]]*$/d' || true)"

if [[ -n "$FILTERED" ]]; then
    { printf '%s\n' "$FILTERED"; printf '%s\n' "$CRON_LINE"; } | crontab -
else
    printf '%s\n' "$CRON_LINE" | crontab -
fi

echo "=== Задача установлена в crontab ==="
crontab -l | grep -F "$MARKER"
echo
echo "Расписание : $CRON_SCHEDULE"
echo "Скрипт     : $ROOT/cron_dump_db.sh"
echo "Лог        : $ROOT/db_dump/logs/cron.log"
echo "Архив      : $ROOT/db_dump/archive/ (хранится последние ${ARCHIVE_KEEP:-30} копий)"
echo
echo "Удалить задачу:"
echo "  crontab -l | grep -v '# microshop-db-backup' | crontab -"
