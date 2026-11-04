#!/usr/bin/env bash
# Ставит в crontab ЛОКАЛЬНОЙ машины ежедневный бэкап прод-сервера и догоняющий
# запуск при включении машины.
#
# Вызывает scripts/backup/pull_prod_backup.sh (дамп БД + media + .env + метаданные
# в ~/Документы/pismo_backup), а на `@reboot` — scripts/backup/backup_if_stale.sh:
# cron НЕ повторяет пропущенные задачи, поэтому ночной бэкап в 04:15 пропускался
# целиком у выключенного компьютера (проверено 2026-09-20: копий не было три дня).
# Повторный запуск безопасен: строки с маркером "# pismo-prod-backup" заменяются,
# дубликатов не появляется.
#
# Использование:
#   ./scripts/backup/install_local_cron.sh                    # ежедневно в 04:15 + при включении
#   CRON_SCHEDULE='0 */6 * * *' ./scripts/backup/install_local_cron.sh
#
# Удалить задачи:
#   crontab -l | grep -v '# pismo-prod-backup' | crontab -

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/backup/pull_prod_backup.sh"
CATCHUP_SCRIPT="$ROOT/scripts/backup/backup_if_stale.sh"
MARKER="# pismo-prod-backup"
CATCHUP_MARKER="# pismo-prod-backup-catchup"
# Догоняющий запуск не только при включении: машина может неделю не
# перезагружаться (только засыпать), и тогда `@reboot` не срабатывает вовсе.
# Полдень — время, когда машина обычно включена; свежая копия ничего не делает.
CATCHUP_DAY_MARKER="# pismo-prod-backup-catchup-day"
CRON_SCHEDULE="${CRON_SCHEDULE:-15 4 * * *}"
CATCHUP_DAY_SCHEDULE="${CATCHUP_DAY_SCHEDULE:-0 12 * * *}"

if ! command -v crontab >/dev/null 2>&1; then
    echo "!!! crontab не найден. Установи cron (например: sudo apt install cron)." >&2
    exit 1
fi

if [[ ! -x "$SCRIPT" ]]; then
    chmod +x "$SCRIPT"
fi
if [[ ! -x "$CATCHUP_SCRIPT" ]]; then
    chmod +x "$CATCHUP_SCRIPT"
fi

# Каталог проекта может содержать пробелы/кириллицу — экранируем для crontab.
ESCAPED_SCRIPT="$(printf '%s' "$SCRIPT" | sed "s/'/'\\\\''/g")"
ESCAPED_CATCHUP="$(printf '%s' "$CATCHUP_SCRIPT" | sed "s/'/'\\\\''/g")"
# Адрес прода и ключ в репозитории не хранятся: cron получает их переменными.
# Экспортируйте их перед запуском — они попадут во все строки задач.
cron_env_prefix() {
    local var value escaped out=""
    for var in PROD_SSH PROD_KEY PROD_DIR PROD_PROJECT; do
        value="${!var:-}"
        [[ -n "$value" ]] || continue
        escaped="$(printf '%s' "$value" | sed "s/'/'\\\\''/g")"
        out+="$var='$escaped' "
    done
    printf '%s' "$out"
}
ENV_PREFIX="$(cron_env_prefix)"
if [[ -z "${PROD_SSH:-}" ]]; then
    echo "!!! PROD_SSH не задан — задачи установятся, но бэкап не сможет подключиться." >&2
    echo "    Экспортируйте PROD_SSH=user@host (и PROD_KEY=... при необходимости) и повторите." >&2
fi

# ВАЖНО: маркер идёт В КОНЦЕ строки. Спереди команды он превращал всю строку в
# комментарий — cron исправно «выполнял» его, и бэкап не делался вовсе.
CRON_LINE="$CRON_SCHEDULE ${ENV_PREFIX}'$ESCAPED_SCRIPT' $MARKER"
# `@reboot` — догоняющий запуск: если копия старше STALE_HOURS (20 ч), снимаем её
# сразу после включения; свежая — ничего не делаем (см. backup_if_stale.sh).
CATCHUP_LINE="@reboot ${ENV_PREFIX}'$ESCAPED_CATCHUP' $CATCHUP_MARKER"
CATCHUP_DAY_LINE="$CATCHUP_DAY_SCHEDULE ${ENV_PREFIX}'$ESCAPED_CATCHUP' $CATCHUP_DAY_MARKER"

CURRENT="$(crontab -l 2>/dev/null || true)"
# Один фильтр на оба маркера: второй содержит первый как префикс.
FILTERED="$(printf '%s\n' "$CURRENT" | grep -v -F "$MARKER" | sed '/^[[:space:]]*$/d' || true)"

if [[ -n "$FILTERED" ]]; then
    {
        printf '%s\n' "$FILTERED"
        printf '%s\n' "$CRON_LINE"
        printf '%s\n' "$CATCHUP_LINE"
        printf '%s\n' "$CATCHUP_DAY_LINE"
    } | crontab -
else
    {
        printf '%s\n' "$CRON_LINE"
        printf '%s\n' "$CATCHUP_LINE"
        printf '%s\n' "$CATCHUP_DAY_LINE"
    } | crontab -
fi

echo "=== Задачи установлены в локальный crontab ==="
crontab -l | grep -F "$MARKER"
echo
echo "Расписание : $CRON_SCHEDULE (+ догоняющий запуск при включении машины и в $CATCHUP_DAY_SCHEDULE)"
echo "Скрипт     : $SCRIPT"
echo "Догоняющий : $CATCHUP_SCRIPT (порог STALE_HOURS=20)"
echo "Куда кладёт: ${BACKUP_DIR:-$HOME/Документы/pismo_backup}"
echo "Лог        : ${BACKUP_DIR:-$HOME/Документы/pismo_backup}/logs/backup.log"
echo
echo "Проверить прямо сейчас:"
echo "  '$SCRIPT'"
echo "  '$CATCHUP_SCRIPT' --check"
echo
echo "Удалить задачи:"
echo "  crontab -l | grep -v '# pismo-prod-backup' | crontab -"
