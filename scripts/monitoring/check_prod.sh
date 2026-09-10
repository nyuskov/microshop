#!/usr/bin/env bash
# Мониторинг прод-сервера с локальной машины: сайт, API (/api/v1/health),
# защита эндпоинтов, диск, контейнеры, свежесть бэкапа. При проблеме —
# оповещение на e-mail (SMTP), опционально SMS.
#
# Почему e-mail: Telegram недоступен ни с прод-сервера, ни с локальной машины
# (блокировка в РФ-сетях, проверено), а SMS Aero без договора с операторами
# отклоняет все SMS. SMTP-данные берутся из локального .env, а если там пусто —
# из продового .env (одной настройки хватает на оба скрипта).
#
# Запускается по cron локально (см. install_local_cron.sh) каждые 15 минут.
#
# Использование:
#   ./scripts/monitoring/check_prod.sh              # проверить и оповестить при проблеме
#   ./scripts/monitoring/check_prod.sh --dry-run    # только отчёт, без отправки
#   ./scripts/monitoring/check_prod.sh --test-alert # отправить тестовое письмо
#
# Переменные окружения:
#   SITE_URL         — https://pismo.space
#   ALERT_EMAIL      — куда писать оповещения (nyuskov@gmail.com)
#   ALERT_SMS        — 1 включает SMS через SMS Aero (по умолчанию выключено)
#   ALERT_PHONE      — номер для SMS при ALERT_SMS=1
#   ALERT_MIN_INTERVAL — не чаще одного оповещения в N минут по той же проблеме (180)
#   DISK_MIN_FREE_PERCENT — порог свободного места на сервере (10)
#   BACKUP_MAX_AGE_HOURS  — максимальный возраст последнего дампа (26)
#   SMTP_* — если заданы локально, берутся они; иначе читаются с прода

set -uo pipefail
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE_URL="${SITE_URL:-https://pismo.space}"
PROD_SSH="${PROD_SSH:-user1@176.108.249.9}"
PROD_KEY="${PROD_KEY:-$HOME/.ssh/id_rsa1}"
PROD_DIR="${PROD_DIR:-~/microshop}"
PROD_PROJECT="${PROD_PROJECT:-microshop-test}"
PROD_COMPOSE_FILE="${PROD_COMPOSE_FILE:-docker-compose.test.yaml}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/Документы/pismo_backup}"
STATE_DIR="${STATE_DIR:-$BACKUP_DIR/logs}"
LOG_FILE="$STATE_DIR/monitor.log"
STATE_FILE="$STATE_DIR/monitor.state"

ALERT_EMAIL="${ALERT_EMAIL:-nyuskov@gmail.com}"
ALERT_SMS="${ALERT_SMS:-0}"
ALERT_PHONE="${ALERT_PHONE:-+79109744376}"
ALERT_MIN_INTERVAL="${ALERT_MIN_INTERVAL:-180}"
DISK_MIN_FREE_PERCENT="${DISK_MIN_FREE_PERCENT:-10}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"

MODE="check"
case "${1:-}" in
    --dry-run) MODE="dry" ;;
    --test-alert) MODE="test" ;;
esac

mkdir -p "$STATE_DIR"
SSH_OPTS=(-i "$PROD_KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)
remote() { ssh -n "${SSH_OPTS[@]}" "$PROD_SSH" "$@"; }

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

# --- Каналы оповещения ------------------------------------------------------

# sms_aero отправляет SMS владельцу через SMS Aero. Включён по умолчанию ВЫКЛючен
# (ALERT_SMS=1): без договора с операторами SMS Aero отклоняет все сообщения.
sms_aero() {
    local text="$1"
    [[ "$ALERT_SMS" == "1" ]] || return 0
    [[ "$MODE" == "dry" ]] && { log "DRY-RUN: SMS не отправлен: $text"; return 0; }

    local email="${SMS_AERO_EMAIL:-}" key="${SMS_AERO_API_KEY:-}"
    if [[ -z "$email" || -z "$key" ]] && [[ -f "$ROOT/.env" ]]; then
        email="$(grep -m1 '^SMS_AERO_EMAIL=' "$ROOT/.env" | cut -d= -f2-)"
        key="$(grep -m1 '^SMS_AERO_API_KEY=' "$ROOT/.env" | cut -d= -f2-)"
    fi
    if [[ -z "$email" || -z "$key" ]]; then
        log "!!! Не заданы SMS_AERO_EMAIL/SMS_AERO_API_KEY — SMS не отправлено"
        return 1
    fi

    curl -s -m 20 -u "$email:$key" --get \
        --data-urlencode "number=${ALERT_PHONE#+}" \
        --data-urlencode "text=$text" \
        --data-urlencode "sign=${SMS_AERO_SIGN:-SMS Aero}" \
        "https://gate.smsaero.ru/v2/sms/send" >/dev/null
}

# --- Доступ к SMTP-настройкам для оповещений ---
# Порядок: окружение → локальный .env → продовый .env (чтобы не настраивать дважды).
SMTP_HOST=""
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASSWORD=""
SMTP_FROM=""
SMTP_STARTTLS="true"
SMTP_SSL="false"

read_env_key() {  # read_env_key <файл|""> <ключ>
    local file="$1" key="$2"
    [[ -n "$file" && -f "$file" ]] || return 1
    grep -m1 "^${key}=" "$file" | cut -d= -f2-
}

load_smtp_settings() {
    local key value source=""
    for source in "" "$ROOT/.env" "$BACKUP_DIR/misc/latest_env.txt"; do
        [[ -n "$source" ]] || continue
        [[ -f "$source" ]] || continue
        if [[ -n "$(read_env_key "$source" SMTP_HOST || true)" ]]; then
            break
        fi
        source=""
    done

    if [[ -z "$source" ]]; then
        # Локально пусто — пробуем прочитать продовый .env по ssh.
        local tmp
        tmp="$(mktemp)"
        if remote "cat $PROD_DIR/.env" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
            source="$tmp"
        else
            rm -f "$tmp"
            return 0
        fi
        SMTP_SETTINGS_TMP="$tmp"
    fi

    for key in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_FROM SMTP_STARTTLS SMTP_SSL; do
        value="$(read_env_key "$source" "$key" || true)"
        [[ -n "$value" ]] && printf -v "$key" '%s' "$value"
    done
}

smtp_configured() { [[ -n "$SMTP_HOST" && -n "$SMTP_FROM" ]]; }

# Письмо-оповещение (основной канал).
smtp_alert() {
    local subject="$1" text="$2"
    [[ "$MODE" == "dry" ]] && { log "DRY-RUN: письмо не отправлено на $ALERT_EMAIL: $subject"; return 0; }
    smtp_configured || return 1

    python3 - "$SMTP_HOST" "$SMTP_PORT" "$SMTP_USER" "$SMTP_PASSWORD" \
        "$SMTP_FROM" "$ALERT_EMAIL" "$SMTP_STARTTLS" "$SMTP_SSL" "$subject" "$text" <<'PY'
import smtplib, ssl, sys
from email.message import EmailMessage

host, port, user, password, sender, to, starttls, use_ssl, subject, text = sys.argv[1:11]
msg = EmailMessage()
msg["From"] = sender
msg["To"] = to
msg["Subject"] = subject
msg.set_content(text)

ctx = ssl.create_default_context()
if use_ssl == "true":
    server = smtplib.SMTP_SSL(host, int(port), timeout=20, context=ctx)
else:
    server = smtplib.SMTP(host, int(port), timeout=20)
with server:
    if use_ssl != "true" and starttls == "true":
        server.starttls(context=ctx)
    if user:
        server.login(user, password)
    server.send_message(msg)
PY
}

# Оповещение с защитой от спама: повторно по той же проблеме — не чаще ALERT_MIN_INTERVAL.
notify() {
    local status="$1" message="$2" fingerprint="$3"
    local now last_hash last_ts
    now="$(date +%s)"
    last_hash="$(sed -n '1p' "$STATE_FILE" 2>/dev/null || true)"
    last_ts="$(sed -n '2p' "$STATE_FILE" 2>/dev/null || echo 0)"

    if [[ "$status" == "problem" && "$fingerprint" == "$last_hash" ]]; then
        if (( now - last_ts < ALERT_MIN_INTERVAL * 60 )); then
            log "Дедупликация: та же проблема, оповещение не отправлено ($message)"
            return 0
        fi
    fi

    log "ОПОВЕЩЕНИЕ ($status): $message"
    local text
    if [[ "$status" == "problem" ]]; then
        text="Проблема на проде Pismo.\n\n$message\n\nПроверено: $(date '+%Y-%m-%d %H:%M:%S')"
    else
        text="Прод Pismo снова в норме.\n\n$message"
    fi

    if [[ "${1:-}" == "test" || "$MODE" == "test" ]]; then
        text="Тестовое оповещение мониторинга Pismo.\n\nЕсли вы получили это письмо — канал оповещений работает."
    fi

    # Основной канал — e-mail; SMS только если явно включён (ALERT_SMS=1).
    local sent=0
    if smtp_alert "Pismo: мониторинг прода" "$(printf '%b' "$text")"; then
        sent=1
        log "Оповещение отправлено на $ALERT_EMAIL"
    else
        log "!!! Письмо не отправлено (SMTP не настроен или ошибка)"
    fi
    if [[ "$ALERT_SMS" == "1" ]]; then
        sms_aero "$(printf '%b' "$text" | tr '\n' ' ')"
        sent=1
    fi

    if [[ "$sent" -eq 0 && "$MODE" != "dry" ]]; then
        log "!!! НЕТ КАНАЛА ОПОВЕЩЕНИЙ: настройте SMTP (docs/email-smtp.md) — иначе о проблемах вы не узнаете"
        echo "!!! ВНИМАНИЕ: оповещение не отправлено — SMTP не настроен, SMS выключен (ALERT_SMS=1 включает)."
        echo "    Настройка: ./scripts/smtp/configure_smtp_on_prod.sh (см. docs/email-smtp.md)"
    fi

    if [[ "$MODE" != "dry" ]]; then
        printf '%s\n%s\n' "$fingerprint" "$now" > "$STATE_FILE"
    fi
}

# --- Проверки ---------------------------------------------------------------

# Настройки SMTP для оповещений (окружение → локальный .env → продовый).
load_smtp_settings

PROBLEMS=()
add_problem() { PROBLEMS+=("$1"); }

# check_http <url> <имя> [ожидаемый код] [подстрока в теле]
#
# Проверка тела обязательна для API: наружу nginx проксирует только `/api/` и
# `/media/`, а любой другой путь (включая корневой `/health`) отдаёт SPA-фолбэк
# с кодом 200 — без проверки содержимого падение API выглядело бы как «всё в
# норме». По той же причине health опрашивается по пути `/api/v1/health`.
BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

check_http() {
    local url="$1" name="$2" expect="${3:-200}" needle="${4:-}"
    local code
    code="$(curl -s -o "$BODY_FILE" -m 15 -w '%{http_code}' "$url" 2>/dev/null)"
    [[ -z "$code" ]] && code="000"
    if [[ "$code" != "$expect" ]]; then
        add_problem "$name: HTTP $code ($url)"
        return 1
    fi
    if [[ -n "$needle" ]] && ! grep -qF "$needle" "$BODY_FILE"; then
        add_problem "$name: ответ не похож на API (нет '$needle') — отдаёт что-то другое ($url)"
        return 1
    fi
    return 0
}

if [[ "$MODE" == "test" ]]; then
    if smtp_configured; then
        echo "SMTP: $SMTP_HOST:$SMTP_PORT, отправитель $SMTP_FROM → $ALERT_EMAIL"
    else
        echo "SMTP не настроен — тестовое письмо отправить некуда (см. docs/email-smtp.md)"
    fi
    notify "test" "тест" "test"
    echo "Готово. Подробности: $LOG_FILE"
    exit 0
fi

echo "=== Проверка прода $SITE_URL ($(date '+%Y-%m-%d %H:%M:%S')) ==="

# 1) Сайт и API живы. Важно: health и прочие не-/api пути на проде отдаёт
# SPA-фолбэк (200 + HTML), поэтому проверяем именно проксируемые пути — и
# сверяем содержимое ответа, иначе «проверка» проходит на мёртвом API.
check_http "$SITE_URL/" "сайт (фронтенд)" 200 "<!DOCTYPE html" || true
check_http "$SITE_URL/api/v1/health" "API /api/v1/health" 200 '"status"' || true
check_http "$SITE_URL/api/v1/health/ready" "API /api/v1/health/ready (БД)" 200 '"database":"ok"' || true
check_http "$SITE_URL/api/v1/auth/channels/" "API /auth/channels (роутер api_v1)" 200 '"otp_available"' || true
# Защищённый эндпоинт без токена обязан требовать авторизацию: 200 здесь означал
# бы утечку данных (регрессия в зависимостях FastAPI).
check_http "$SITE_URL/api/v1/users/search/?query=smoke" "защита API (401 без токена)" 401 || true

# 2) Контейнеры на сервере и место на диске
SSH_OUT="$(remote "cd $PROD_DIR && docker compose -p '$PROD_PROJECT' -f '$PROD_COMPOSE_FILE' ps --format '{{.Service}} {{.Status}}' && echo '---DISK---' && df -P / | tail -1" 2>&1)"
if [[ $? -ne 0 || -z "$SSH_OUT" ]]; then
    add_problem "нет SSH-доступа к серверу $PROD_SSH"
else
    CONTAINERS="$(printf '%s\n' "$SSH_OUT" | sed '/---DISK---/,$d')"
    while read -r service status; do
        [[ -z "${service:-}" ]] && continue
        if ! printf '%s' "$status" | grep -q "^Up"; then
            add_problem "контейнер $service не запущен ($status)"
        elif printf '%s' "$status" | grep -qi "unhealthy"; then
            add_problem "контейнер $service нездоров ($status)"
        fi
    done <<< "$CONTAINERS"

    DISK_LINE="$(printf '%s\n' "$SSH_OUT" | sed -n '/---DISK---/,$p' | tail -1)"
    DISK_USE="$(printf '%s' "$DISK_LINE" | awk '{print $5}' | tr -d '%')"
    if [[ "$DISK_USE" =~ ^[0-9]+$ ]]; then
        FREE=$((100 - DISK_USE))
        echo "диск сервера: занято ${DISK_USE}%, свободно ${FREE}%"
        if (( FREE < DISK_MIN_FREE_PERCENT )); then
            add_problem "мало места на диске сервера: свободно ${FREE}% (< ${DISK_MIN_FREE_PERCENT}%)"
        fi
    fi
fi

# 3) Свежесть последнего бэкапа (заодно проверка, что локальный cron бэкапа жив)
LATEST_DUMP="$(find "$BACKUP_DIR/db" -maxdepth 1 -name 'microshop_*.sql.gz' -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"
if [[ -z "$LATEST_DUMP" ]]; then
    add_problem "не найден ни один дамп БД в $BACKUP_DIR/db (бэкап не работает?)"
else
    AGE_HOURS=$(( ( $(date +%s) - $(stat -c %Y "$LATEST_DUMP") ) / 3600 ))
    echo "последний дамп: $(basename "$LATEST_DUMP"), возраст ${AGE_HOURS} ч"
    if (( AGE_HOURS > BACKUP_MAX_AGE_HOURS )); then
        add_problem "последний дамп БД старше ${BACKUP_MAX_AGE_HOURS} ч (${AGE_HOURS} ч) — бэкап не снимается?"
    fi
fi

# --- Итог -------------------------------------------------------------------
if [[ ${#PROBLEMS[@]} -eq 0 ]]; then
    echo "Всё в норме."
    log "OK: все проверки пройдены"
    # Если раньше была проблема — сообщаем о восстановлении.
    PREV="$(sed -n '1p' "$STATE_FILE" 2>/dev/null || true)"
    if [[ -n "$PREV" && "$PREV" != "test" ]]; then
        notify "recovered" "все проверки снова проходят" "ok"
    fi
    exit 0
fi

echo
echo "Проблемы:"
FINGERPRINT=""
for problem in "${PROBLEMS[@]}"; do
    echo "  • $problem"
    FINGERPRINT+="$problem;"
done

notify "problem" "$(printf '%s; ' "${PROBLEMS[@]}")" "$(printf '%s' "$FINGERPRINT" | md5sum | cut -d' ' -f1)"
if [[ "$MODE" == "dry" ]]; then
    echo
    echo "(dry-run: оповещение не отправлялось)"
fi
exit 1
