#!/usr/bin/env bash
# Ставит в локальный crontab проверку прода каждые 15 минут.
#
# Вызывает scripts/monitoring/check_prod.sh: сайт, /api/v1/health,
# /api/v1/health/ready, защита эндпоинтов, контейнеры, место на диске, свежесть
# бэкапа; при проблеме — письмо по SMTP
# (Telegram из РФ-сетей недоступен, SMS Aero без договора отклоняет SMS).
#
# Использование:
#   ./scripts/monitoring/install_local_cron.sh
#   CRON_SCHEDULE='*/5 * * * *' ./scripts/monitoring/install_local_cron.sh
#
# Удалить:
#   crontab -l | grep -v '# pismo-monitor' | crontab -

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/monitoring/check_prod.sh"
MARKER="# pismo-monitor"
CRON_SCHEDULE="${CRON_SCHEDULE:-*/15 * * * *}"

command -v crontab >/dev/null 2>&1 || {
    echo "!!! crontab не найден (sudo apt install cron)" >&2
    exit 1
}

chmod +x "$SCRIPT"
ESCAPED_SCRIPT="$(printf '%s' "$SCRIPT" | sed "s/'/'\\\\''/g")"

# Адрес прода, ключ и адрес оповещений в репозитории не хранятся: cron получает
# их переменными. Экспортируйте их перед запуском — они попадут в строку задачи.
cron_env_prefix() {
    local var value escaped out=""
    for var in PROD_SSH PROD_KEY PROD_DIR PROD_PROJECT ALERT_EMAIL ALERT_PHONE SITE_URL; do
        value="${!var:-}"
        [[ -n "$value" ]] || continue
        escaped="$(printf '%s' "$value" | sed "s/'/'\\\\''/g")"
        out+="$var='$escaped' "
    done
    printf '%s' "$out"
}
ENV_PREFIX="$(cron_env_prefix)"
if [[ -z "${PROD_SSH:-}" ]]; then
    echo "!!! PROD_SSH не задан — задача установится, но мониторинг не сможет подключиться." >&2
    echo "    Экспортируйте PROD_SSH=user@host (и PROD_KEY=... при необходимости) и повторите." >&2
fi

# Маркер — в конце: перед командой он превращал строку в комментарий и
# проверки молча не запускались.
CRON_LINE="$CRON_SCHEDULE ${ENV_PREFIX}'$ESCAPED_SCRIPT' >/dev/null 2>&1 $MARKER"

CURRENT="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "$CURRENT" | grep -v -F "$MARKER" | sed '/^[[:space:]]*$/d' || true)"

if [[ -n "$FILTERED" ]]; then
    { printf '%s\n' "$FILTERED"; printf '%s\n' "$CRON_LINE"; } | crontab -
else
    printf '%s\n' "$CRON_LINE" | crontab -
fi

echo "=== Проверка прода установлена в локальный crontab ==="
crontab -l | grep -F "$MARKER"
echo
echo "Расписание : $CRON_SCHEDULE"
echo "Скрипт     : $SCRIPT"
echo "Лог        : ${BACKUP_DIR:-$HOME/Документы/pismo_backup}/logs/monitor.log"
echo
echo "Проверить сейчас:   '$SCRIPT'"
echo "Отчёт без писем:    '$SCRIPT' --dry-run"
echo "Тест оповещения:    '$SCRIPT' --test-alert   (отправит тестовое письмо)"
echo "Удалить задачу:     crontab -l | grep -v '# pismo-monitor' | crontab -"
