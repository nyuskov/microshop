#!/usr/bin/env bash
# Печатает имя слота бэкенда, который сейчас в работе: `web-green` или `web-blue`.
#
# Зачем: бэкенд обновляется «синим/зелёным» способом — в работе всегда один из
# двух слотов (см. docs/production.md и scripts/ci/deploy_remote.sh), поэтому
# сервиса `web` больше нет, а скриптам, которые заходят в контейнер приложения,
# нужно знать актуальное имя.
#
# Запускается НА сервере (там, где живёт docker): сервер читает файл состояния
# деплоя, а если его нет — смотрит, какой контейнер реально запущен.
#
# Использование:
#   slot="$(sh scripts/lib/web_slot.sh)"
#   docker compose -p microshop-test -f docker-compose.test.yaml exec -T "$slot" ...

set -euo pipefail

PROJECT="${PROJECT:-microshop-test}"
STATE_FILE="${STATE_FILE:-$HOME/.microshop-deploy/active-web-slot}"

running() {
    [ "$(docker inspect -f '{{.State.Running}}' "$PROJECT-$1-1" 2>/dev/null || true)" = "true" ]
}

# 1. Файл состояния деплоя — точнее всего, но только если слот действительно жив.
if [ -f "$STATE_FILE" ]; then
    saved="$(cat "$STATE_FILE" 2>/dev/null || true)"
    case "$saved" in
        web-blue|web-green)
            if running "$saved"; then
                echo "$saved"
                exit 0
            fi
            ;;
    esac
fi

# 2. Иначе — тот слот, чей контейнер запущен.
for slot in web-blue web-green; do
    if running "$slot"; then
        echo "$slot"
        exit 0
    fi
done

echo "не нашёл запущенный слот бэкенда (ни web-blue, ни web-green)" >&2
exit 1
