#!/usr/bin/env bash
# Догоняющий бэкап: снимает копию прода, только если последняя копия устарела.
#
# Зачем: cron НЕ повторяет пропущенные задачи. Ночной бэкап стоит в 04:15, а
# компьютер в это время обычно выключен — и копии просто не снимаются (проверено
# 2026-09-20: последняя копия была от 17.09, в логах мониторинга в 04:xx пусто —
# машина спала). Этот скрипт вешается на `@reboot`: как только машина включилась,
# он смотрит на возраст свежего дампа и, если тот старше STALE_HOURS, снимает
# новый. Если копия свежая (машина перезагрузилась днём после ночного бэкапа) —
# ничего не делает, поэтому `@reboot` не плодит лишние копии при каждом включении.
#
# Использование:
#   ./scripts/backup/backup_if_stale.sh            # снять, если устарела
#   ./scripts/backup/backup_if_stale.sh --check     # только сказать, нужен ли
#   STALE_HOURS=6 ./scripts/backup/backup_if_stale.sh
#
# Переменные: STALE_HOURS (по умолчанию 20), BACKUP_DIR (как в pull_prod_backup.sh).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_SCRIPT="$ROOT/scripts/backup/pull_prod_backup.sh"
BACKUP_DIR="${BACKUP_DIR:-$HOME/Документы/pismo_backup}"
DB_DIR="$BACKUP_DIR/db"
STALE_HOURS="${STALE_HOURS:-20}"

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Свежий дамп ищем по времени изменения: имена содержат метку, но полагаться на
# разбор имени не нужно — файл всё равно ложится сразу после снятия.
newest_dump_age_hours() {
    local newest
    newest="$(ls -1t "$DB_DIR"/microshop_*.sql.gz 2>/dev/null | head -1 || true)"
    if [[ -z "$newest" ]]; then
        echo ""
        return
    fi
    local age_seconds
    age_seconds=$(( $(date +%s) - $(stat -c %Y "$newest") ))
    echo $(( age_seconds / 3600 ))
}

AGE="$(newest_dump_age_hours)"

if [[ -z "$AGE" ]]; then
    log "Копий БД ещё нет — снимаю бэкап"
elif (( AGE >= STALE_HOURS )); then
    log "Свежий дамп старше ${STALE_HOURS} ч (по факту ${AGE} ч) — снимаю бэкап"
else
    log "Копия свежая (${AGE} ч) — бэкап не нужен"
    exit 0
fi

if (( CHECK_ONLY )); then
    log "--check: бэкап был бы снят (проверка без запуска)"
    exit 0
fi

exec "$BACKUP_SCRIPT"
