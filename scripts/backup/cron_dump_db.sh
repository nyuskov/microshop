#!/usr/bin/env bash
# Запуск дампа БД по расписанию (cron).
#
# Вызывается из crontab пользователя (устанавливается скриптом
# ./scripts/backup/install_server_cron.sh) и делает то же самое, что
# scripts/db/dump_db.sh, но:
#   * пишет лог в db_dump/logs/cron.log (не в stdout, т.к. cron собирает вывод сам);
#   * ограничивает число архивных копий: дампы — 7 последних, media — по одному
#     снимку за день за последние 2 дня.
#
# Переменные окружения (необязательно):
#   ARCHIVE_KEEP       — сколько дампов БД хранить (по умолчанию 7);
#   ARCHIVE_KEEP_MEDIA — сколько ДНЕЙ хранить снимки media (по умолчанию 2);
#   DUMP_LOG_FILE      — путь к файлу лога (по умолчанию db_dump/logs/cron.log).

set -euo pipefail

# cron запускается с урезанным PATH — дополняем его, чтобы найти docker.
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Корень репозитория: в нём лежат compose-файлы и каталог db_dump с логами/архивами.
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

ARCHIVE_KEEP="${ARCHIVE_KEEP:-7}"
# Медиа-архив — это ВСЕ вложения целиком, поэтому по дням, а не «последние N»:
# два запуска подряд (ручной + cron) давали две почти одинаковые копии.
ARCHIVE_KEEP_MEDIA="${ARCHIVE_KEEP_MEDIA:-2}"
LOG_FILE="${DUMP_LOG_FILE:-$ROOT/db_dump/logs/cron.log}"
ARCHIVE_DIR="$ROOT/db_dump/archive"

mkdir -p "$(dirname "$LOG_FILE")" "$ARCHIVE_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

{
    log "=== Запуск дампа БД (cron) ==="

    if "$HERE/../db/dump_db.sh"; then
        log "Дамп БД успешно снят."
    else
        log "!!! Дамп БД завершился с ошибкой (код $?)."
        exit 1
    fi

    # Медиафайлы (вложения/аватары) — отдельный архив; ошибка не роняет дамп БД.
    if "$HERE/backup_media.sh"; then
        log "Бэкап media успешно снят."
    else
        log "!!! Бэкап media завершился с ошибкой (код $?)."
    fi

    # Чистим старые архивные копии: оставляем последние ARCHIVE_KEEP.
    if [[ "$ARCHIVE_KEEP" =~ ^[0-9]+$ ]] && [[ "$ARCHIVE_KEEP" -gt 0 ]]; then
        # Дампы БД: имена вида microshop_YYYYMMDD_HHMMSS.sql: сортировка по имени == по времени.
        mapfile -t old_files < <(
            ls -1 "$ARCHIVE_DIR" 2>/dev/null \
                | grep -E '\.sql$' \
                | sort -r \
                | tail -n +$((ARCHIVE_KEEP + 1)) || true
        )
        for file in "${old_files[@]:-}"; do
            [[ -z "$file" ]] && continue
            rm -f -- "$ARCHIVE_DIR/$file"
            log "Удалён старый архив: $file"
        done

        # Архивы media: оставляем только САМЫЙ СВЕЖИЙ снимок за каждый день,
        # за последние ARCHIVE_KEEP_MEDIA дней (та же логика, что у бэкапа прода —
        # см. scripts/backup/pull_prod_backup.sh).
        if [[ "$ARCHIVE_KEEP_MEDIA" =~ ^[0-9]+$ ]] && [[ "$ARCHIVE_KEEP_MEDIA" -gt 0 ]]; then
            declare -A media_days
            kept_days=0
            mapfile -t media_files < <(
                ls -1 "$ARCHIVE_DIR" 2>/dev/null \
                    | grep -E '^media_[0-9]{8}_[0-9]{6}\.tar\.gz$' \
                    | sort -r || true
            )
            for file in "${media_files[@]:-}"; do
                [[ -z "$file" ]] && continue
                day="${file#media_}"
                day="${day%%_*}"
                if [[ -z "${media_days[$day]:-}" ]] && [[ "$kept_days" -lt "$ARCHIVE_KEEP_MEDIA" ]]; then
                    media_days[$day]=1
                    kept_days=$((kept_days + 1))
                    continue
                fi
                media_days[$day]=1
                rm -f -- "$ARCHIVE_DIR/$file"
                log "Удалён старый media-архив: $file"
            done
        fi
    fi

    log "=== Готово (хранится: дампов ${ARCHIVE_KEEP}, снимков media за ${ARCHIVE_KEEP_MEDIA} дн.) ==="
} >> "$LOG_FILE" 2>&1
