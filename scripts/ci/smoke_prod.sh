#!/usr/bin/env bash
# Смоук-тест прода после деплоя: сайт отдаётся, API жив, БД доступна, роутеры
# собраны, защита эндпоинтов на месте. Запускается из CI (.github/workflows/ci.yml,
# job smoke) после шага деплоя, а также руками — локально или с сервера.
#
# Почему это нужно: `docker compose up -d` завершается успешно и тогда, когда
# внутри контейнера всё падает (например, миграция не применилась, роутер не
# импортировался). Такой деплой сейчас считается успешным — этот скрипт ловит.
#
# Использование:
#   ./scripts/ci/smoke_prod.sh
#   SITE_URL=https://pismo.space SMOKE_TIMEOUT=30 ./scripts/ci/smoke_prod.sh
#
# Переменные окружения:
#   SITE_URL       — база для проверок (https://pismo.space)
#   SMOKE_TIMEOUT  — сколько секунд ждать готовности (180; контейнеры после деплоя
#                    перезапускаются не мгновенно)
#   SMOKE_INTERVAL — пауза между попытками (5)
#
# Код возврата: 0 — всё прошло, 1 — есть провалы (в CI это падение job'а).

set -uo pipefail

SITE_URL="${SITE_URL:-https://pismo.space}"
SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-180}"
SMOKE_INTERVAL="${SMOKE_INTERVAL:-5}"

# Проверки: имя|путь|ожидаемый код|подстрока в теле (пусто — тело не проверяем).
# ВАЖНО: наружу nginx проксирует только `/api/` и `/media/`, всё остальное
# отдаёт SPA-фолбэк с кодом 200 — поэтому health берём по пути `/api/v1/health`,
# иначе «проверка» пройдёт на мёртвом API (там будет HTML-страница).
CHECKS=(
    "фронтенд|/|200|<!DOCTYPE html"
    "API /health|/api/v1/health|200|\"status\""
    "API /health/ready (БД)|/api/v1/health/ready|200|\"database\":\"ok\""
    "роутер auth (каналы входа)|/api/v1/auth/channels/|200|\"otp_available\""
)

FAILED=()
NAME=""
URL=""
EXPECT=""
NEEDLE=""
CODE=""
DETAIL=""
BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

# check_once <путь> <ожидаемый код> <подстрока>; результат — в CODE/DETAIL.
check_once() {
    local path="$1" expect="$2" needle="$3"
    CODE="$(curl -sS -o "$BODY_FILE" -m 20 -w '%{http_code}' "$SITE_URL$path" 2>/dev/null)"
    [[ -z "$CODE" ]] && CODE="000"
    DETAIL=""
    if [[ "$CODE" != "$expect" ]]; then
        DETAIL="HTTP $CODE, ожидался $expect"
        return 1
    fi
    # Регистр не важен: DOCTYPE после форматирования может стать `<!doctype html>`.
    if [[ -n "$needle" ]] && ! grep -qiF "$needle" "$BODY_FILE"; then
        DETAIL="в ответе нет '$needle'"
        return 1
    fi
    return 0
}

# Тяжёлая проверка: защищённый эндпоинт без токена обязан отвечать 401/403.
check_auth_guard() {
    local code
    code="$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$SITE_URL/api/v1/users/search/?query=smoke" 2>/dev/null)"
    [[ -z "$code" ]] && code="000"
    case "$code" in
        401|403) return 0 ;;
        200) DETAIL="защищённый /users/search/ отвечает 200 без токена — утечка данных"; return 1 ;;
        *) DETAIL="HTTP $code, ожидался 401/403"; return 1 ;;
    esac
}

echo "=== Смоук-тест прода $SITE_URL ($(date '+%Y-%m-%d %H:%M:%S')) ==="

DEADLINE=$(( $(date +%s) + SMOKE_TIMEOUT ))
ATTEMPT=0
while :; do
    ATTEMPT=$((ATTEMPT + 1))
    FAILED=()
    for entry in "${CHECKS[@]}"; do
        IFS='|' read -r NAME URL EXPECT NEEDLE <<< "$entry"
        if ! check_once "$URL" "$EXPECT" "$NEEDLE"; then
            FAILED+=("$NAME ($SITE_URL$URL): $DETAIL")
        fi
    done
    if ! check_auth_guard; then
        FAILED+=("защита эндпоинтов: $DETAIL")
    fi

    if [[ ${#FAILED[@]} -eq 0 ]]; then
        echo "Все проверки пройдены (попытка $ATTEMPT, $(date '+%H:%M:%S'))."
        exit 0
    fi

    NOW=$(date +%s)
    if (( NOW >= DEADLINE )); then
        break
    fi
    echo "попытка $ATTEMPT: провалено ${#FAILED[@]} проверок, повтор через ${SMOKE_INTERVAL}с (осталось $((DEADLINE - NOW))с)"
    sleep "$SMOKE_INTERVAL"
done

echo
echo "=== ПРОД НЕ ПРОШЁЛ СМОУК-ТЕСТ (ждали ${SMOKE_TIMEOUT}с) ==="
for line in "${FAILED[@]}"; do
    echo "  • $line"
    # Аннотация для GitHub Actions — ошибка появится прямо в интерфейсе job'а.
    echo "::error::Смоук-тест прода: $line"
done
exit 1
