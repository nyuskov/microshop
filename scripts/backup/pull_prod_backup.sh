#!/usr/bin/env bash
# Бэкап прод-сервера на локальную машину: дамп БД + media + .env + метаданные.
#
# Запускается НА ЛОКАЛЬНОЙ машине (не на сервере) и выкачивает всё по ssh:
#   db/microshop_<дата>.sql.gz   — дамп PostgreSQL (восстановление: gunzip -c … | psql)
#   media/media_<дата>.tar.gz    — файлы из /app/media (вложения, аватары, GIF)
#   misc/env_<дата>.txt          — продовый .env (секреты; права 600)
#   misc/info_<дата>.txt         — ревизия git, список контейнеров, размеры
#
# Папка по умолчанию: ~/Документы/pismo_backup (можно задать BACKUP_DIR).
# Старые копии ротируются: KEEP_DB (14), KEEP_MEDIA (7), KEEP_MISC (14).
#
# Использование:
#   ./scripts/backup/pull_prod_backup.sh            # полный бэкап
#   BACKUP_DIR=/mnt/backup ./scripts/backup/pull_prod_backup.sh
#
# Переменные окружения:
#   BACKUP_DIR        — куда складывать (по умолчанию ~/Документы/pismo_backup)
#   PROD_SSH          — user@host (по умолчанию user1@176.108.249.9)
#   PROD_KEY          — путь к приватному ключу (по умолчанию ~/.ssh/id_rsa1)
#   PROD_DIR          — каталог проекта на сервере (по умолчанию ~/microshop)
#   PROD_PROJECT      — имя compose-проекта (по умолчанию microshop-test)
#   PROD_COMPOSE_FILE — файл compose (по умолчанию docker-compose.prod.yaml)
#   REMOTE_MEDIA_PATH — путь к media на сервере; если задан, берётся он,
#                       иначе media читается из контейнера web (/app/media)
#   KEEP_DB / KEEP_MEDIA / KEEP_MISC — сколько копий хранить
#
# Коды возврата: 0 — всё снято; 1 — ошибка (в т.ч. частичная: см. лог).

set -uo pipefail

# cron запускается с урезанным PATH — дополняем, чтобы найти ssh/gzip/flock.
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin"

BACKUP_DIR="${BACKUP_DIR:-$HOME/Документы/pismo_backup}"
PROD_SSH="${PROD_SSH:-user1@176.108.249.9}"
PROD_KEY="${PROD_KEY:-$HOME/.ssh/id_rsa1}"
PROD_DIR="${PROD_DIR:-~/microshop}"
PROD_PROJECT="${PROD_PROJECT:-microshop-test}"
PROD_COMPOSE_FILE="${PROD_COMPOSE_FILE:-docker-compose.prod.yaml}"
DB_NAME="${DB_NAME:-microshop}"
DB_USER="${DB_USER:-postgres}"
REMOTE_MEDIA_PATH="${REMOTE_MEDIA_PATH:-}"

KEEP_DB="${KEEP_DB:-14}"
KEEP_MEDIA="${KEEP_MEDIA:-7}"
KEEP_MISC="${KEEP_MISC:-14}"

STAMP="$(date +%Y%m%d_%H%M%S)"
DB_DIR="$BACKUP_DIR/db"
MEDIA_DIR="$BACKUP_DIR/media"
MISC_DIR="$BACKUP_DIR/misc"
LOG_DIR="$BACKUP_DIR/logs"
LOG_FILE="$LOG_DIR/backup.log"

mkdir -p "$DB_DIR" "$MEDIA_DIR" "$MISC_DIR" "$LOG_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Единая точка логирования: и в файл, и в stdout (cron соберёт stdout себе).
exec > >(tee -a "$LOG_FILE") 2>&1

SSH_OPTS=(-i "$PROD_KEY" -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new)

remote() { ssh "${SSH_OPTS[@]}" "$PROD_SSH" "$@"; }

compose() {
    remote "cd $PROD_DIR && docker compose -p '$PROD_PROJECT' -f '$PROD_COMPOSE_FILE' $*"
}

# Оставляет keep самых новых файлов, остальные удаляет (сортировка по имени = по времени).
rotate() {
    local dir="$1" pattern="$2" keep="$3"
    [[ "$keep" =~ ^[0-9]+$ ]] || return 0
    [[ "$keep" -gt 0 ]] || return 0
    mapfile -t old < <(ls -1 "$dir" 2>/dev/null | grep -E "$pattern" | sort -r | tail -n +$((keep + 1)))
    for file in "${old[@]:-}"; do
        [[ -z "$file" ]] && continue
        rm -f -- "$dir/$file"
        log "Ротация: удалён $dir/$file"
    done
}

# Не даём двум запускам (cron + ручной) перепутать архивы.
LOCK_FILE="$LOG_DIR/.pull.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    log "!!! Бэкап уже выполняется (lock $LOCK_FILE) — выход"
    exit 0
fi

log "=== Бэкап прода → $BACKUP_DIR ==="

FAILED=0

# --- Связь с сервером ---
if ! remote "test -d $PROD_DIR"; then
    log "!!! Нет доступа к $PROD_SSH:$PROD_DIR (проверь ключ PROD_KEY=$PROD_KEY)"
    exit 1
fi

# --- 1) Дамп БД ---
DB_TARGET="$DB_DIR/microshop_$STAMP.sql.gz"
log "==> Дамп БД ($DB_NAME)…"
if compose "exec -T db pg_dump -U '$DB_USER' -d '$DB_NAME' --no-owner --no-privileges" \
    | gzip -9 > "$DB_TARGET.part"; then
    if gzip -t "$DB_TARGET.part" 2>/dev/null && [[ -s "$DB_TARGET.part" ]]; then
        mv "$DB_TARGET.part" "$DB_TARGET"
        ln -sfn "$(basename "$DB_TARGET")" "$DB_DIR/latest.sql.gz"
        log "    OK: $DB_TARGET ($(du -h "$DB_TARGET" | cut -f1))"
        rotate "$DB_DIR" '^microshop_[0-9]{8}_[0-9]{6}\.sql\.gz$' "$KEEP_DB"
    else
        rm -f "$DB_TARGET.part"
        log "    !!! Дамп повреждён или пуст — файл удалён"
        FAILED=1
    fi
else
    rm -f "$DB_TARGET.part"
    log "    !!! Не удалось снять дамп БД"
    FAILED=1
fi

# --- 2) Media (вложения, аватары, GIF) ---
MEDIA_TARGET="$MEDIA_DIR/media_$STAMP.tar.gz"
log "==> Архив media…"
if [[ -n "$REMOTE_MEDIA_PATH" ]]; then
    MEDIA_CMD="remote \"tar czf - -C $REMOTE_MEDIA_PATH .\""
else
    # Бэкенд живёт в двух слотах (синий/зелёный) — берём тот, что сейчас в работе.
    WEB_SLOT="$(remote "cd $PROD_DIR && sh scripts/lib/web_slot.sh" | tr -d '\r' || true)"
    if [[ -z "$WEB_SLOT" ]]; then
        log "    !!! Не удалось определить слот бэкенда — архив media пропущен"
        MEDIA_CMD="false"
    else
        MEDIA_CMD="compose \"exec -T $WEB_SLOT tar czf - -C /app/media .\""
    fi
fi
if eval "$MEDIA_CMD" > "$MEDIA_TARGET.part" 2>/dev/null; then
    if gzip -t "$MEDIA_TARGET.part" 2>/dev/null; then
        mv "$MEDIA_TARGET.part" "$MEDIA_TARGET"
        ln -sfn "$(basename "$MEDIA_TARGET")" "$MEDIA_DIR/latest.tar.gz"
        log "    OK: $MEDIA_TARGET ($(du -h "$MEDIA_TARGET" | cut -f1))"
        rotate "$MEDIA_DIR" '^media_[0-9]{8}_[0-9]{6}\.tar\.gz$' "$KEEP_MEDIA"
    else
        rm -f "$MEDIA_TARGET.part"
        log "    !!! Архив media повреждён — файл удалён"
        FAILED=1
    fi
else
    rm -f "$MEDIA_TARGET.part"
    log "    !!! Не удалось снять media (проверь REMOTE_MEDIA_PATH)"
    FAILED=1
fi

# --- 3) Продовый .env (секреты) ---
ENV_TARGET="$MISC_DIR/env_$STAMP.txt"
log "==> Продовый .env (секреты, права 600)…"
if remote "cat $PROD_DIR/.env" > "$ENV_TARGET.part" 2>/dev/null && [[ -s "$ENV_TARGET.part" ]]; then
    mv "$ENV_TARGET.part" "$ENV_TARGET"
    chmod 600 "$ENV_TARGET"
    ln -sfn "$(basename "$ENV_TARGET")" "$MISC_DIR/latest_env.txt"
    log "    OK: $ENV_TARGET"
    rotate "$MISC_DIR" '^env_[0-9]{8}_[0-9]{6}\.txt$' "$KEEP_MISC"
else
    rm -f "$ENV_TARGET.part"
    log "    !!! Не удалось забрать .env"
    FAILED=1
fi

# --- 4) Метаданные: ревизия, контейнеры, размеры ---
INFO_TARGET="$MISC_DIR/info_$STAMP.txt"
log "==> Метаданные (ревизия, контейнеры)…"
{
    echo "# Снято: $(date '+%Y-%m-%d %H:%M:%S %Z') с $PROD_SSH:$PROD_DIR"
    echo
    echo "## git revision"
    remote "cd $PROD_DIR && git rev-parse HEAD"
    echo
    echo "## контейнеры"
    compose "ps --format '{{.Service}} {{.Status}}'"
    echo
    echo "## размеры в бэкапе"
    echo "db:    $(du -h "$DB_TARGET" 2>/dev/null | cut -f1)"
    echo "media: $(du -h "$MEDIA_TARGET" 2>/dev/null | cut -f1)"
} > "$INFO_TARGET" 2>&1
ln -sfn "$(basename "$INFO_TARGET")" "$MISC_DIR/latest_info.txt"
rotate "$MISC_DIR" '^info_[0-9]{8}_[0-9]{6}\.txt$' "$KEEP_MISC"
log "    OK: $INFO_TARGET"

# --- Итог ---
TOTAL="$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)"
DB_COPIES="$(find "$DB_DIR" -maxdepth 1 -type f -name 'microshop_*.sql.gz' 2>/dev/null | wc -l)"
MEDIA_COPIES="$(find "$MEDIA_DIR" -maxdepth 1 -type f -name 'media_*.tar.gz' 2>/dev/null | wc -l)"
if [[ "$FAILED" -eq 0 ]]; then
    log "=== Готово. Копий: БД $DB_COPIES / media $MEDIA_COPIES. Занято: $TOTAL ==="
    exit 0
fi

log "=== ЗАВЕРШЕНО С ОШИБКАМИ (см. строки «!!!» выше). Занято: $TOTAL ==="
exit 1
