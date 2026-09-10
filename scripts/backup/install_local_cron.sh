#!/usr/bin/env bash
# Ставит в crontab ЛОКАЛЬНОЙ машины ежедневный бэкап прод-сервера.
#
# Вызывает scripts/backup/pull_prod_backup.sh (дамп БД + media + .env + метаданные
# в ~/Документы/pismo_backup). Повторный запуск безопасен: строка с маркером
# "# pismo-prod-backup" заменяется, дубликатов не появляется.
#
# Использование:
#   ./scripts/backup/install_local_cron.sh                    # ежедневно в 04:15
#   CRON_SCHEDULE='0 */6 * * *' ./scripts/backup/install_local_cron.sh
#
# Удалить задачу:
#   crontab -l | grep -v '# pismo-prod-backup' | crontab -

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/backup/pull_prod_backup.sh"
MARKER="# pismo-prod-backup"
CRON_SCHEDULE="${CRON_SCHEDULE:-15 4 * * *}"

if ! command -v crontab >/dev/null 2>&1; then
    echo "!!! crontab не найден. Установи cron (например: sudo apt install cron)." >&2
    exit 1
fi

if [[ ! -x "$SCRIPT" ]]; then
    chmod +x "$SCRIPT"
fi

# Каталог проекта может содержать пробелы/кириллицу — экранируем для crontab.
ESCAPED_SCRIPT="$(printf '%s' "$SCRIPT" | sed "s/'/'\\\\''/g")"
CRON_LINE="$CRON_SCHEDULE $MARKER '$ESCAPED_SCRIPT'"

CURRENT="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "$CURRENT" | grep -v -F "$MARKER" | sed '/^[[:space:]]*$/d' || true)"

if [[ -n "$FILTERED" ]]; then
    { printf '%s\n' "$FILTERED"; printf '%s\n' "$CRON_LINE"; } | crontab -
else
    printf '%s\n' "$CRON_LINE" | crontab -
fi

echo "=== Задача установлена в локальный crontab ==="
crontab -l | grep -F "$MARKER"
echo
echo "Расписание : $CRON_SCHEDULE"
echo "Скрипт     : $SCRIPT"
echo "Куда кладёт: ${BACKUP_DIR:-$HOME/Документы/pismo_backup}"
echo "Лог        : ${BACKUP_DIR:-$HOME/Документы/pismo_backup}/logs/backup.log"
echo
echo "Проверить прямо сейчас:"
echo "  '$SCRIPT'"
echo
echo "Удалить задачу:"
echo "  crontab -l | grep -v '# pismo-prod-backup' | crontab -"
