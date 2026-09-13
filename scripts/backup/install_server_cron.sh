#!/usr/bin/env bash
# Устанавливает в crontab СЕРВЕРА ежедневный бэкап БД и media (по умолчанию в 03:00).
# Вызывает scripts/backup/cron_dump_db.sh — тот снимает дамп БД
# (scripts/db/dump_db.sh), затем media (scripts/backup/backup_media.sh), пишет лог
# и ограничивает число архивных копий в <корень репозитория>/db_dump/.
#
# Повторный запуск безопасен: строка с маркером "# microshop-db-backup"
# заменяется на новую (дубликатов не появляется).
#
# Использование:
#   ./scripts/backup/install_server_cron.sh                    # ежедневно в 03:00
#   CRON_SCHEDULE='0 */6 * * *' ./scripts/backup/install_server_cron.sh   # каждые 6 часов
#   CRON_SCRIPT=/путь/к/своему-скрипту.sh ./scripts/backup/install_server_cron.sh
#
# Удаление задачи:
#   crontab -l | grep -v '# microshop-db-backup' | crontab -

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${CRON_SCRIPT:-$ROOT/scripts/backup/cron_dump_db.sh}"
MARKER="# microshop-db-backup"
CRON_SCHEDULE="${CRON_SCHEDULE:-0 3 * * *}"

if ! command -v crontab >/dev/null 2>&1; then
    echo "!!! crontab не найден. Установите cron (например: sudo apt install cron)." >&2
    exit 1
fi

if [[ ! -x "$SCRIPT" ]]; then
    chmod +x "$SCRIPT"
fi

# Путь может содержать пробелы/не-ASCII символы — оборачиваем в одинарные кавычки.
ESCAPED_ROOT="$(printf '%s' "$ROOT" | sed "s/'/'\\\\''/g")"
ESCAPED_SCRIPT="$(printf '%s' "$SCRIPT" | sed "s/'/'\\\\''/g")"
# ВАЖНО: маркер — В КОНЦЕ строки. Спереди команды он превращал её в
# комментарий: cron «выполнял» его, и бэкап молча не делался.
CRON_LINE="$CRON_SCHEDULE cd '$ESCAPED_ROOT' && '$ESCAPED_SCRIPT' $MARKER"

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
echo "Скрипт     : $SCRIPT"
echo "Лог        : $ROOT/db_dump/logs/cron.log"
echo "Архив      : $ROOT/db_dump/archive/ (хранится последние ${ARCHIVE_KEEP:-30} копий)"
echo
echo "Проверить прямо сейчас:"
echo "  '$SCRIPT'"
echo
echo "Удалить задачу:"
echo "  crontab -l | grep -v '# microshop-db-backup' | crontab -"
