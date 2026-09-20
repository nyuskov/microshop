#!/usr/bin/env bash
#
# Пример: выгрузка локальных дампов БД microshop в удалённое хранилище (rclone).
#
# Использование:
#   1. rclone config  — создать remote (пример remote-имени в RCLONE_REMOTE ниже)
#   2. cp scripts/backup/backup_offsite.example.sh scripts/backup/backup_offsite.sh && chmod +x scripts/backup/backup_offsite.sh
#   3. Отредактируйте переменные в начале файла.
#   4. Добавьте в crontab (см. docs/offsite-backup.md).
#
set -euo pipefail

# Удалённое хранилище rclone, напр. "backup:bucket/microshop" (без завершающего /)
RCLONE_REMOTE="${RCLONE_REMOTE:-backup:bucket/microshop}"
# Директория с локальными дампами (каталог db_dump в корне репозитория)
LOCAL_DUMP_DIR="${LOCAL_DUMP_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/db_dump}"
# Поддиректория с архивами локальных дампов
ARCHIVE_SUBDIR="${ARCHIVE_SUBDIR:-archive}"
# Сколько последних архивных копий выгружать (0 = все)
# По умолчанию 7 — как и локальная ротация дампов (`ARCHIVE_KEEP`), чтобы в облаке
# не копились копии, которые мы уже удалили у себя.
ARCHIVE_KEEP_OFFSITE="${ARCHIVE_KEEP_OFFSITE:-7}"
# Лог
LOG_FILE="${LOG_FILE:-${LOCAL_DUMP_DIR}/logs/offsite.log}"

# Шифрование перед отправкой (файл-пароль, см. scripts/lib/backup_crypto.sh).
# Без файла-пароля работает как раньше (выгрузка открытых файлов + предупреждение).
. "$(cd "$(dirname "$0")/../lib" && pwd)/backup_crypto.sh"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >>"$LOG_FILE"; }

if backup_encryption_available; then
    log "Шифрование включено (файл-пароль: ${BACKUP_PASSPHRASE_FILE})"
else
    log "ВНИМАНИЕ: шифрование выключено (нет ${BACKUP_PASSPHRASE_FILE}) — файлы уедут открытыми"
fi

command -v rclone >/dev/null 2>&1 || { log "rclone не найден"; exit 1; }
[ -f "${LOCAL_DUMP_DIR}/microshop_latest.sql" ] || { log "нет свежего дампа — пропуск"; exit 0; }

mkdir -p "$(dirname "$LOG_FILE")"

log "Начало выгрузки в ${RCLONE_REMOTE}"

# 1. Всегда выгружаем актуальный дамп (зашифрованным, если есть файл-пароль).
rclone copy "$(encrypt_backup "${LOCAL_DUMP_DIR}/microshop_latest.sql")" "${RCLONE_REMOTE}/" \
    --log-file="$LOG_FILE" 2>>"$LOG_FILE" || log "ошибка выгрузки latest"

# 2. Последние N архивных копий.
if [ "${ARCHIVE_KEEP_OFFSITE}" -gt 0 ] && [ -d "${LOCAL_DUMP_DIR}/${ARCHIVE_SUBDIR}" ]; then
    mapfile -t files < <(ls -1t "${LOCAL_DUMP_DIR}/${ARCHIVE_SUBDIR}/"microshop_*.sql 2>/dev/null | head -n "${ARCHIVE_KEEP_OFFSITE}" || true)
    for file in "${files[@]:-}"; do
        [ -n "$file" ] || continue
        rclone copy "$(encrypt_backup "$file")" "${RCLONE_REMOTE}/${ARCHIVE_SUBDIR}/" \
            --log-file="$LOG_FILE" 2>>"$LOG_FILE" || log "ошибка выгрузки $(basename "$file")"
    done
fi

# 3. Медиафайлы (вложения/аватары) — снимок из scripts/backup/backup_media.sh, если есть.
if [ -f "${LOCAL_DUMP_DIR}/media_latest.tar.gz" ]; then
    rclone copy "$(encrypt_backup "${LOCAL_DUMP_DIR}/media_latest.tar.gz")" "${RCLONE_REMOTE}/" \
        --log-file="$LOG_FILE" 2>>"$LOG_FILE" || log "ошибка выгрузки media_latest"
    if [ "${ARCHIVE_KEEP_OFFSITE}" -gt 0 ] && [ -d "${LOCAL_DUMP_DIR}/${ARCHIVE_SUBDIR}" ]; then
        mapfile -t mfiles < <(ls -1t "${LOCAL_DUMP_DIR}/${ARCHIVE_SUBDIR}/"media_*.tar.gz 2>/dev/null | head -n "${ARCHIVE_KEEP_OFFSITE}" || true)
        for file in "${mfiles[@]:-}"; do
            [ -n "$file" ] || continue
            rclone copy "$(encrypt_backup "$file")" "${RCLONE_REMOTE}/${ARCHIVE_SUBDIR}/" \
                --log-file="$LOG_FILE" 2>>"$LOG_FILE" || log "ошибка выгрузки $(basename "$file")"
        done
    fi
fi

log "Выгрузка завершена"
