#!/usr/bin/env bash
# Запуск дампа БД по расписанию (cron).
#
# Вызывается из crontab пользователя (устанавливается скриптом
# ./install_cron_backup.sh) и делает то же самое, что ./dump_db.sh, но:
#   * пишет лог в db_dump/logs/cron.log (не в stdout, т.к. cron собирает вывод сам);
#   * ограничивает число архивных копий (по умолчанию хранятся последние 30).
#
# Переменные окружения (необязательно):
#   ARCHIVE_KEEP   — сколько архивных копий хранить (по умолчанию 30);
#   DUMP_LOG_FILE  — путь к файлу лога (по умолчанию db_dump/logs/cron.log).

set -euo pipefail

# cron запускается с урезанным PATH — дополняем его, чтобы найти docker.
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

ARCHIVE_KEEP="${ARCHIVE_KEEP:-30}"
LOG_FILE="${DUMP_LOG_FILE:-$ROOT/db_dump/logs/cron.log}"
ARCHIVE_DIR="$ROOT/db_dump/archive"

mkdir -p "$(dirname "$LOG_FILE")" "$ARCHIVE_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

{
    log "=== Запуск дампа БД (cron) ==="

    if ./dump_db.sh; then
        log "Дамп БД успешно снят."
    else
        log "!!! Дамп БД завершился с ошибкой (код $?)."
        exit 1
    fi

    # Медиафайлы (вложения/аватары) — отдельный архив; ошибка не роняет дамп БД.
    if ./backup_media.sh; then
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

        # Архивы media: имена media_YYYYMMDD_HHMMSS.tar.gz.
        mapfile -t old_media < <(
            ls -1 "$ARCHIVE_DIR" 2>/dev/null \
                | grep -E '^media_[0-9]{8}_[0-9]{6}\.tar\.gz$' \
                | sort -r \
                | tail -n +$((ARCHIVE_KEEP + 1)) || true
        )
        for file in "${old_media[@]:-}"; do
            [[ -z "$file" ]] && continue
            rm -f -- "$ARCHIVE_DIR/$file"
            log "Удалён старый media-архив: $file"
        done
    fi

    log "=== Готово (архив хранится: последние ${ARCHIVE_KEEP} копий) ==="
} >> "$LOG_FILE" 2>&1
