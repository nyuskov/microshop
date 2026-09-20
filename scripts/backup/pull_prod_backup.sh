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
#
# Старые копии ротируются (см. «Хранение копий» ниже): дампы БД — 7 последних +
# по одной за каждую из 3 недель (итого история до 30 дней), media — по снимку
# за день за 3 дня, .env и метаданные — 5 последних.
#
# Использование:
#   ./scripts/backup/pull_prod_backup.sh            # полный бэкап
#   ./scripts/backup/pull_prod_backup.sh --prune    # только подчистить старое (без сети)
#   ./scripts/backup/pull_prod_backup.sh --prune --dry-run   # показать, что удалится
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
#   KEEP_DB / KEEP_DB_WEEKS / KEEP_DB_MONTHS — сколько хранить дампов БД
#                       (свежих / недельных / месячных; месячные по умолчанию 0)
#   KEEP_MEDIA        — сколько ДНЕЙ хранить архивы media (по одному снимку в день)
#   KEEP_MISC         — сколько хранить копий .env и метаданных
#
# Коды возврата: 0 — всё снято; 1 — ошибка (в т.ч. частичная: см. лог);
#                2 — неизвестный аргумент.

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

# Сколько копий хранить. Дамп БД весит десятки килобайт, а архив media — десятки
# мегабайт (и растёт вместе с вложениями), поэтому политика разная: у БД —
# «отец-сын-внук» (свежие + недельные), у media — по снимку в день за последние
# KEEP_MEDIA дней.
#
# Глубина по умолчанию — ДО 30 ДНЕЙ: ровно столько обещано в
# `docs/pd-internal-documents.md` (персональные данные). Хотите глубже — поднимите
# KEEP_DB_WEEKS / KEEP_DB_MONTHS и поправьте тот документ: копии содержат личные
# данные, и держать их дольше обещанного нельзя.
KEEP_DB="${KEEP_DB:-7}"
KEEP_DB_WEEKS="${KEEP_DB_WEEKS:-3}"
KEEP_DB_MONTHS="${KEEP_DB_MONTHS:-0}"
KEEP_MEDIA="${KEEP_MEDIA:-3}"
KEEP_MISC="${KEEP_MISC:-5}"

# Режимы: --prune — только подчистить старое (без сети), --dry-run — показать,
# что было бы удалено, ничего не удаляя.
PRUNE_ONLY=0
DRY_RUN=0
for arg in "$@"; do
    case "$arg" in
        --prune) PRUNE_ONLY=1 ;;
        --dry-run) DRY_RUN=1 ;;
        *)
            echo "Неизвестный аргумент: $arg (есть --prune, --dry-run)" >&2
            exit 2
            ;;
    esac
done

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
        if [[ "$DRY_RUN" -eq 1 ]]; then
            log "Ротация (dry-run): удалил бы $dir/$file"
            continue
        fi
        rm -f -- "$dir/$file"
        log "Ротация: удалён $dir/$file"
    done
}

# Политика хранения дампов БД: свежие + НЕДЕЛЬНЫЕ («отец-сын-внук»).
#
# Почему не «последние N»: дамп БД весит десятки килобайт, хранить историю
# дёшево, а вот потерять возможность откатиться на позапрошлую неделю — дорого
# (порча данных замечается не сразу, а когда замечена — свежие копии уже
# содержат ту же проблему). Считаем недели/месяцы по дате из имени файла.
#
# Глубина истории ограничена не диском, а обещанием из `docs/pd-internal-documents.md`
# («копии до 30 дней»): по умолчанию 7 свежих + 3 недельных — как раз около
# месяца. Месячные копии (KEEP_DB_MONTHS) выключены, пока документ не изменится.
rotate_db_history() {
    local dir="$1" keep_daily="$2" keep_weeks="$3" keep_months="$4"
    [[ "$keep_daily" =~ ^[0-9]+$ ]] && [[ "$keep_weeks" =~ ^[0-9]+$ ]] || return 0
    [[ "$keep_months" =~ ^[0-9]+$ ]] || return 0

    local -a files=()
    mapfile -t files < <(
        ls -1 "$dir" 2>/dev/null \
            | grep -E '^microshop_[0-9]{8}_[0-9]{6}\.sql\.gz$' \
            | sort -r
    )

    local -A used_weeks=() used_months=()
    local index=0 kept_weeks=0 kept_months=0
    local file day week month keep
    for file in "${files[@]:-}"; do
        [[ -z "$file" ]] && continue
        index=$((index + 1))
        day="${file#microshop_}"
        day="${day%%_*}"
        week="$(date -d "${day:0:4}-${day:4:2}-${day:6:2}" +%G-%V 2>/dev/null || true)"
        month="$(date -d "${day:0:4}-${day:4:2}-${day:6:2}" +%Y-%m 2>/dev/null || true)"
        keep=0
        if [[ "$index" -le "$keep_daily" ]]; then
            keep=1
        elif [[ -n "$week" && -z "${used_weeks[$week]:-}" && "$kept_weeks" -lt "$keep_weeks" ]]; then
            keep=1
            kept_weeks=$((kept_weeks + 1))
        elif [[ -n "$month" && -z "${used_months[$month]:-}" && "$kept_months" -lt "$keep_months" ]]; then
            keep=1
            kept_months=$((kept_months + 1))
        fi
        # Неделю/месяц помечаем и для оставленных «свежих» копий: иначе та же
        # неделя получила бы ещё одну копию «как недельная».
        [[ -n "$week" ]] && used_weeks[$week]=1
        [[ -n "$month" ]] && used_months[$month]=1
        [[ "$keep" -eq 1 ]] && continue
        if [[ "$DRY_RUN" -eq 1 ]]; then
            log "Ротация (dry-run): удалил бы $dir/$file"
            continue
        fi
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

# Политика хранения архивов media: по ОДНОМУ САМОМУ СВЕЖЕМУ снимку за день,
# столько дней, сколько просят (KEEP_MEDIA).
#
# Почему по дням: архив media — это ВСЕ вложения целиком, он весит десятки
# мегабайт и растёт вместе с ними. Два запуска подряд (ручной + cron) давали две
# почти одинаковые копии — на них и уходило место.
rotate_media_history() {
    local dir="$1" keep_days="$2"
    [[ "$keep_days" =~ ^[0-9]+$ ]] && [[ "$keep_days" -gt 0 ]] || return 0

    local -a files=()
    mapfile -t files < <(
        ls -1 "$dir" 2>/dev/null \
            | grep -E '^media_[0-9]{8}_[0-9]{6}\.tar\.gz$' \
            | sort -r
    )

    local -A used_days=()
    local kept_days=0 file day
    for file in "${files[@]:-}"; do
        [[ -z "$file" ]] && continue
        day="${file#media_}"
        day="${day%%_*}"
        if [[ -z "${used_days[$day]:-}" && "$kept_days" -lt "$keep_days" ]]; then
            used_days[$day]=1
            kept_days=$((kept_days + 1))
            continue
        fi
        # Второй (и далее) снимок того же дня — лишний: он почти такой же.
        used_days[$day]=1
        if [[ "$DRY_RUN" -eq 1 ]]; then
            log "Ротация (dry-run): удалил бы $dir/$file"
            continue
        fi
        rm -f -- "$dir/$file"
        log "Ротация: удалён $dir/$file"
    done
}

# Полная ротация: по одной копии на каждую папку (нужна и в режиме --prune).
prune_backups() {
    rotate_db_history "$DB_DIR" "$KEEP_DB" "$KEEP_DB_WEEKS" "$KEEP_DB_MONTHS"
    rotate_media_history "$MEDIA_DIR" "$KEEP_MEDIA"
    rotate "$MISC_DIR" '^env_[0-9]{8}_[0-9]{6}\.txt$' "$KEEP_MISC"
    rotate "$MISC_DIR" '^info_[0-9]{8}_[0-9]{6}\.txt$' "$KEEP_MISC"
}

# --prune: подчистить старое без похода на сервер. Нужен после смены лимитов
# (уменьшили KEEP_* — лишние копии надо убрать) и для разовой уборки.
if [[ "$PRUNE_ONLY" -eq 1 ]]; then
    PRUNE_HINT=""
    [[ "$DRY_RUN" -eq 1 ]] && PRUNE_HINT=" (dry-run)"
    log "=== Подчистка старых копий$PRUNE_HINT ==="
    prune_backups
    log "=== Готово. Копий: БД $(find "$DB_DIR" -maxdepth 1 -type f -name 'microshop_*.sql.gz' 2>/dev/null | wc -l) / media $(find "$MEDIA_DIR" -maxdepth 1 -type f -name 'media_*.tar.gz' 2>/dev/null | wc -l). Занято: $(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1) ==="
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
        rotate_db_history "$DB_DIR" "$KEEP_DB" "$KEEP_DB_WEEKS" "$KEEP_DB_MONTHS"
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
        rotate_media_history "$MEDIA_DIR" "$KEEP_MEDIA"
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
