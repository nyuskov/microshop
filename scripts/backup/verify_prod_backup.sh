#!/usr/bin/env bash
# Автопроверка бэкапа: разворачиваем последний дамп в отдельную БД на прод-сервере
# и проверяем, что он читается и совпадает с продом по ревизии миграций и объёму
# данных.
#
# Зачем: «бэкап есть» и «бэкап восстанавливается» — разные вещи. Файл может
# оказаться обрезанным, восстановление может упасть на середине (например, из-за
# смены версии Postgres), а узнаётся об этом обычно в самый неподходящий момент.
# Проверка запускается локально по cron раз в неделю.
#
# Что делает по шагам:
#   1) берёт самый свежий локальный дамп ($BACKUP_DIR/db/latest.sql.gz);
#   2) проверяет целостность архива (gzip -t) — обрезанный файл отсекается сразу;
#   3) создаёт на проде временную БД microshop_verify и разворачивает в неё дамп
#      (дамп идёт по ssh напрямую в psql контейнера, на сервере не остаётся);
#   4) проверяет восстановленную копию: ревизия alembic, наличие аккаунтов и
#      ключевых таблиц (сравнивать с текущим продом бессмысленно — прод живёт,
#      поэтому критерий «копия восстановилась и не пустая»);
#   5) удаляет временную БД (в том числе при ошибке — trap);
#   6) при провале пишет письмо (SMTP), в лог — всегда.
#
# Использование:
#   ./scripts/backup/verify_prod_backup.sh            # проверить и, при провале, оповестить
#   ./scripts/backup/verify_prod_backup.sh --dry-run  # только показать, что будет проверяться
#   ./scripts/backup/verify_prod_backup.sh --no-alert # проверить без отправки письма
#
# Переменные окружения: BACKUP_DIR, PROD_SSH, PROD_KEY, PROD_DIR, PROD_PROJECT,
# PROD_COMPOSE_FILE, ALERT_EMAIL, SMTP_* (см. scripts/lib/notify.sh).

set -uo pipefail
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/Документы/pismo_backup}"
LOG_FILE="$BACKUP_DIR/logs/verify.log"
PROD_SSH="${PROD_SSH:-}"
PROD_KEY="${PROD_KEY:-$HOME/.ssh/id_ed25519}"
PROD_DIR="${PROD_DIR:-~/microshop}"
PROD_PROJECT="${PROD_PROJECT:-microshop-test}"
PROD_COMPOSE_FILE="${PROD_COMPOSE_FILE:-docker-compose.prod.yaml}"
ALERT_EMAIL="${ALERT_EMAIL:-alerts@example.com}"
VERIFY_DB="microshop_verify"

MODE="check"
ALERT=1
case "${1:-}" in
    --dry-run) MODE="dry" ;;
    --no-alert) ALERT=0 ;;
esac

if [[ -z "$PROD_SSH" ]]; then
    echo "!!! Не задан PROD_SSH — укажите user@host (например, PROD_SSH=user@server)" >&2
    exit 2
fi

mkdir -p "$BACKUP_DIR/logs"
SSH_OPTS=(-i "$PROD_KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)
remote() { ssh -n "${SSH_OPTS[@]}" "$PROD_SSH" "$@"; }
# Вариант с stdin (нужен, чтобы отдавать SQL и поток дампа без экранирования).
remote_in() { ssh "${SSH_OPTS[@]}" "$PROD_SSH" "$@"; }
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

# shellcheck source=../lib/notify.sh
source "$ROOT/scripts/lib/notify.sh"

PROBLEMS=()
add_problem() { PROBLEMS+=("$1"); }

# Удаляет временную БД на проде (вызывается и при ошибке).
DROP_DB_CMD="cd $PROD_DIR && docker compose -p $PROD_PROJECT -f $PROD_COMPOSE_FILE exec -T db psql -U postgres -c 'DROP DATABASE IF EXISTS $VERIFY_DB' "
CREATED_DB=0
cleanup() {
    if [[ "$CREATED_DB" == "1" ]]; then
        remote "$DROP_DB_CMD" >/dev/null 2>&1 || log "!!! Не удалось удалить временную БД $VERIFY_DB"
    fi
}
trap cleanup EXIT

# --- 1) Свежий локальный дамп -------------------------------------------------
LATEST="$(find "$BACKUP_DIR/db" -maxdepth 1 -name 'microshop_*.sql.gz' -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"
if [[ -z "$LATEST" ]]; then
    log "ПРОВАЛ: не найден ни один дамп в $BACKUP_DIR/db"
    echo "ПРОВАЛ: не найден ни один дамп в $BACKUP_DIR/db"
    exit 1
fi
echo "Проверяю дамп: $(basename "$LATEST") ($(du -h "$LATEST" | cut -f1))"

if [[ "$MODE" == "dry" ]]; then
    echo "(dry-run) развернул бы дамп в $VERIFY_DB на $PROD_SSH и сверил бы ревизию и счётчики"
    exit 0
fi

# --- 2) Целостность архива ---------------------------------------------------
if ! gzip -t "$LATEST" 2>/dev/null; then
    add_problem "архив дампа повреждён (gzip -t): $(basename "$LATEST")"
fi

# --- 3) Временная БД + восстановление ---------------------------------------
RESTORE_OK=1
if [[ ${#PROBLEMS[@]} -eq 0 ]]; then
    # Прод может быть прямо сейчас в процессе деплоя (контейнеры пересоздаются) —
    # это не повод тревожить владельца, поэтому пробуем несколько раз.
    CREATE_CMD="cd $PROD_DIR && docker compose -p $PROD_PROJECT -f $PROD_COMPOSE_FILE exec -T db psql -U postgres -c 'DROP DATABASE IF EXISTS $VERIFY_DB' >/dev/null && docker compose -p $PROD_PROJECT -f $PROD_COMPOSE_FILE exec -T db psql -U postgres -c 'CREATE DATABASE $VERIFY_DB' >/dev/null"
    CREATE_ATTEMPTS=3
    CREATE_PAUSE=20
    CREATED=0
    for attempt in $(seq 1 "$CREATE_ATTEMPTS"); do
        echo "Создаю временную БД $VERIFY_DB на сервере (попытка $attempt)…"
        if remote "$CREATE_CMD"; then
            CREATED=1
            break
        fi
        if (( attempt < CREATE_ATTEMPTS )); then
            echo "сервер недоступен (возможно, идёт деплой) — повтор через ${CREATE_PAUSE} с"
            sleep "$CREATE_PAUSE"
        fi
    done

    if [[ "$CREATED" != "1" ]]; then
        add_problem "не удалось создать временную БД $VERIFY_DB (сервер недоступен или идёт деплой)"
        RESTORE_OK=0
    else
        CREATED_DB=1
        echo "Разворачиваю дамп (поток gzip → psql)…"
        if ! gzip -dc "$LATEST" | remote_in "cd $PROD_DIR && docker compose -p $PROD_PROJECT -f $PROD_COMPOSE_FILE exec -T db psql -U postgres -d $VERIFY_DB -q -v ON_ERROR_STOP=1" >/dev/null 2>"$BACKUP_DIR/logs/verify_last_error.txt"; then
            add_problem "восстановление дампа упало (см. logs/verify_last_error.txt)"
            RESTORE_OK=0
        fi
    fi
fi

# --- 4) Сверка с продовой БД -------------------------------------------------
STATS=""
if [[ "$RESTORE_OK" == "1" && ${#PROBLEMS[@]} -eq 0 ]]; then
    # Проверяем САМ ДАМП, а не равенство с текущим продом: прод продолжает жить
    # (новые сообщения, новые миграции), поэтому «копия равна проду» — неверный
    # критерий и давал бы ложные тревоги. Что действительно важно:
    #   1) схема в дампе есть (alembic_version + ключевые таблицы);
    #   2) данные есть (аккаунты);
    #   3) видно, какая это ревизия — по ней понятно, какой версии была копия.
    # SQL отдаём через stdin: так не нужно экранировать кавычки через ssh и docker.
    SQL="SELECT 'rev=' || coalesce((SELECT version_num FROM alembic_version LIMIT 1), 'нет')
        || ' user=' || coalesce((SELECT count(*)::text FROM \"user\"), '0')
        || ' chats=' || coalesce((SELECT count(*)::text FROM chats), '0')
        || ' messages=' || coalesce((SELECT count(*)::text FROM messages), '0')
        || ' tables=' || (SELECT count(*)::text FROM information_schema.tables WHERE table_schema = 'public');"

    PSQL_CMD="cd $PROD_DIR && docker compose -p $PROD_PROJECT -f $PROD_COMPOSE_FILE exec -T db psql -U postgres -tA -f -"
    COPY_STATS="$(printf '%s\n' "$SQL" | remote_in "$PSQL_CMD -d $VERIFY_DB" 2>"$BACKUP_DIR/logs/verify_last_error.txt" | tr -d '[:space:]')"

    if [[ -z "$COPY_STATS" ]]; then
        add_problem "не удалось прочитать данные из восстановленной копии (см. logs/verify_last_error.txt)"
    else
        echo "копия: $COPY_STATS"
        STATS="$COPY_STATS"
        if [[ "$COPY_STATS" == *"rev=нет"* ]]; then
            add_problem "в дампе нет ревизии alembic (alembic_version пуст) — схема не восстановится"
        fi
        if [[ "$COPY_STATS" == *"user=0"* ]]; then
            add_problem "в дампе нет ни одного аккаунта (user=0) — такой бэкап бесполезен"
        fi
        # Минимум таблиц: без них восстановление даст нерабочую схему.
        TABLES_COUNT="$(printf '%s' "$COPY_STATS" | sed -n 's/.*tables=\([0-9]*\).*/\1/p')"
        if [[ -n "$TABLES_COUNT" && "$TABLES_COUNT" -lt 15 ]]; then
            add_problem "в дампе подозрительно мало таблиц: $TABLES_COUNT (ожидаем 15+)"
        fi
    fi
fi

# --- 5) Итог и оповещение ----------------------------------------------------
if [[ ${#PROBLEMS[@]} -eq 0 ]]; then
    log "OK: дамп $(basename "$LATEST") восстановлен, схема и данные на месте ($STATS)"
    echo "Всё в порядке: дамп восстанавливается, схема и данные на месте."
    exit 0
fi

echo
echo "ПРОБЛЕМЫ:"
for problem in "${PROBLEMS[@]}"; do
    echo "  • $problem"
    log "ПРОВАЛ: $problem"
done

load_smtp_settings
MESSAGE="Проверка резервной копии Pismo не прошла.

Дамп: $(basename "$LATEST")
$(printf '%s\n' "${PROBLEMS[@]}")

Проверено: $(date '+%Y-%m-%d %H:%M:%S')
Подробности: $LOG_FILE"

if [[ "$ALERT" != "1" ]]; then
    echo "(--no-alert) оповещение не отправлялось"
    exit 1
fi

# Временная пауза оповещений (см. docs/monitoring.md): проверка завершилась
# провалом, но письма нет — статус по-прежнему 1, лог пишется как обычно.
if alerts_paused; then
    log "ПАУЗА ОПОВЕЩЕНИЙ: письмо о провале проверки бэкапа не отправлено"
    echo "Оповещения приостановлены (.alerts-paused) — письмо не отправлено."
    exit 1
fi

if smtp_send "$ALERT_EMAIL" "Pismo: бэкап не прошёл проверку" "$MESSAGE"; then
    log "Оповещение отправлено на $ALERT_EMAIL"
    echo "Оповещение отправлено на $ALERT_EMAIL"
else
    log "!!! Нет канала оповещений: настройте SMTP (docs/email-smtp.md)"
    echo "!!! ВНИМАНИЕ: оповещение не отправлено — SMTP не настроен."
fi

exit 1
