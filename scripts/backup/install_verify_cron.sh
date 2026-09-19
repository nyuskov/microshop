#!/usr/bin/env bash
# Ставит в локальный crontab еженедельную автопроверку бэкапа (по умолчанию —
# воскресенье 12:00: ночью компьютер обычно выключен, а cron пропуск не
# повторяет — в 05:00 проверка просто не запускалась).
#
# Вызывает scripts/backup/verify_prod_backup.sh: разворачивает последний дамп в
# отдельную БД на прод-сервере, проверяет читаемость/схему/данные и при провале
# пишет письмо (SMTP).
#
# Использование:
#   ./scripts/backup/install_verify_cron.sh
#   CRON_SCHEDULE='0 6 * * 3' ./scripts/backup/install_verify_cron.sh
#
# Удалить:
#   crontab -l | grep -v '# pismo-backup-verify' | crontab -

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/backup/verify_prod_backup.sh"
MARKER="# pismo-backup-verify"
CRON_SCHEDULE="${CRON_SCHEDULE:-0 12 * * 0}"

command -v crontab >/dev/null 2>&1 || {
    echo "!!! crontab не найден (sudo apt install cron)" >&2
    exit 1
}

chmod +x "$SCRIPT"
ESCAPED_SCRIPT="$(printf '%s' "$SCRIPT" | sed "s/'/'\\\\''/g")"
CRON_LINE="$CRON_SCHEDULE '$ESCAPED_SCRIPT' >/dev/null 2>&1 $MARKER"

CURRENT="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "$CURRENT" | grep -v -F "$MARKER" | sed '/^[[:space:]]*$/d' || true)"

if [[ -n "$FILTERED" ]]; then
    { printf '%s\n' "$FILTERED"; printf '%s\n' "$CRON_LINE"; } | crontab -
else
    printf '%s\n' "$CRON_LINE" | crontab -
fi

echo "=== Автопроверка бэкапа установлена в локальный crontab ==="
crontab -l | grep -F "$MARKER"
echo
echo "Расписание : $CRON_SCHEDULE"
echo "Скрипт     : $SCRIPT"
echo "Лог        : ${BACKUP_DIR:-$HOME/Документы/pismo_backup}/logs/verify.log"
echo
echo "Проверить сейчас: '$SCRIPT'"
echo "План без работы:  '$SCRIPT' --dry-run"
echo "Удалить задачу:   crontab -l | grep -v '$MARKER' | crontab -"
