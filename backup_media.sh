#!/usr/bin/env bash
# Бэкап медиафайлов приложения (вложения сообщений, аватары, GIF) в ./db_dump.
#
# БД уже дампится скриптами dump_db.sh / cron_dump_db.sh, но сами файлы в
# backend/media (или docker-томе media_data) в них не попадают — этот скрипт
# закрывает пробел. Вызывается из ./cron_dump_db.sh после дампа БД; можно
# запускать и отдельно.
#
# Источник определяется так (по первому совпадению):
#   1) явный $MEDIA_SRC (путь к каталогу);
#   2) хост-каталог ./backend/media (dev: bind-том web/worker) — если непуст;
#   3) docker-том '<project>_media_data' (prod: named volume) — если такой есть;
#   иначе — «пропуск» (код 0): это не ошибка, а штатная ситуация.
#
# Результат:
#   db_dump/media_latest.tar.gz            — актуальный снимок
#   db_dump/archive/media_<дата>.tar.gz    — архивная копия (ротация в cron)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

DUMP_DIR="${DUMP_DIR:-$ROOT/db_dump}"
ARCHIVE_DIR="$DUMP_DIR/archive"
STAMP="$(date +%Y%m%d_%H%M%S)"
LATEST="$DUMP_DIR/media_latest.tar.gz"

mkdir -p "$ARCHIVE_DIR"

HOST_MEDIA="$ROOT/backend/media"

# --- выбор источника -------------------------------------------------------
SRC=""
TAR_MODE=""
if [[ -n "${MEDIA_SRC:-}" ]]; then
    SRC="$MEDIA_SRC"
    TAR_MODE="host"
elif [[ -d "$HOST_MEDIA" ]] && [[ -n "$(find "$HOST_MEDIA" -mindepth 1 2>/dev/null | head -n1)" ]]; then
    SRC="$HOST_MEDIA"
    TAR_MODE="host"
elif command -v docker >/dev/null 2>&1; then
    VOL="$(docker volume ls -q 2>/dev/null | grep -E '(^|_)media_data$' | head -n1 || true)"
    if [[ -n "$VOL" ]]; then
        SRC="$VOL"
        TAR_MODE="volume"
    fi
fi

if [[ -z "$SRC" ]]; then
    echo "Media-бэкап пропущен: не найден источник (backend/media или docker-том *_media_data)."
    exit 0
fi

echo "==> Бэкап media из ($TAR_MODE): $SRC"

TMP="$DUMP_DIR/.media_tmp_$$.tar.gz"
cleanup() { rm -f -- "$TMP"; }
trap cleanup EXIT

if [[ "$TAR_MODE" == "volume" ]]; then
    # Том монтируем во временный контейнер и пакуем его содержимое.
    docker run --rm \
        -v "$SRC":/m:ro \
        -v "$DUMP_DIR":/out \
        alpine tar -czf "/out/$(basename "$TMP")" -C /m .
else
    # Относительный путь backend/media: при распаковке не затрёт ничего лишнего.
    tar -czf "$TMP" -C "$ROOT" backend/media
fi

mv -f -- "$TMP" "$LATEST"
cp -f -- "$LATEST" "$ARCHIVE_DIR/media_${STAMP}.tar.gz"

echo "==> Готово:"
echo "    последний : $LATEST"
echo "    архив     : $ARCHIVE_DIR/media_${STAMP}.tar.gz"
