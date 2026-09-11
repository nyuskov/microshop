#!/usr/bin/env bash
#
# Шифрование резервных копий перед отправкой вовне (общий код для offsite/pull).
#
# Зачем: дамп БД и медиа — это личные данные людей (переписка, телефоны, фото).
# Локальный сервер ещё можно считать «своим», но копия в чужом облаке/на чужом
# диске расшифровывается одним лишь доступом к бакету. Поэтому наружу файлы
# уезжают зашифрованными.
#
# Ключ — НЕ переменная с паролем, а файл-пароль (BACKUP_PASSPHRASE_FILE): так
# пароль не попадает в `ps`, в историю shell и в логи. Если файла нет —
# шифрование просто выключено (скрипт предупредит и продолжит), чтобы
# существующий cron не сломался молча.
#
# Подключение:
#     . "$(dirname "$0")/scripts/lib/backup_crypto.sh"
#     encrypted=$(encrypt_backup "$file") || encrypted="$file"
#
# Обратно (на своей машине):
#     openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in backup.sql.enc -out backup.sql \
#         -pass file:/path/to/passphrase
#
# Формат имени: <исходное имя>.enc — по нему видно, что файл зашифрован.

# Файл с паролем (одна строка). Переопределяется через BACKUP_PASSPHRASE_FILE.
BACKUP_PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-${HOME:-/root}/.pismo-backup-passphrase}"
# Сколько итераций PBKDF2: ключ выводится из пароля медленно, чтобы подбор
# украденного файла был дорогим. 200k — разумный компромисс для cron.
BACKUP_PBKDF2_ITERATIONS="${BACKUP_PBKDF2_ITERATIONS:-200000}"

backup_encryption_available() {
    [ -n "${BACKUP_PASSPHRASE_FILE}" ] \
        && [ -r "${BACKUP_PASSPHRASE_FILE}" ] \
        && command -v openssl >/dev/null 2>&1
}

# Пишет предупреждение один раз за запуск (чтобы не засорять лог cron).
backup_crypto_warn_once() {
    if [ -z "${BACKUP_CRYPTO_WARNED:-}" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ВНИМАНИЕ: $*" >&2
        BACKUP_CRYPTO_WARNED=1
    fi
}

# encrypt_backup <файл> [куда]
#
# Печатает путь зашифрованной копии (в stdout). Если шифрование недоступно —
# печатает исходный путь: вызывающий код работает одинаково в обоих режимах.
# Исходный файл остаётся на месте: локальный cron-бэкап не должен зависеть от
# наличия пароля (иначе при забытом файле мы остались бы без свежих бэкапов).
encrypt_backup() {
    local src="${1:-}"
    local dest="${2:-}"

    if [ -z "${src}" ] || [ ! -f "${src}" ]; then
        return 1
    fi

    if ! backup_encryption_available; then
        backup_crypto_warn_once "BACKUP_PASSPHRASE_FILE (${BACKUP_PASSPHRASE_FILE}) недоступен — выгружаем без шифрования"
        echo "${src}"
        return 0
    fi

    [ -n "${dest}" ] || dest="${src}.enc"

    # Ключ+IV выводятся из пароля (pbkdf2), соль — своя на каждый файл (openssl
    # кладёт её в начало файла, поэтому расшифровка работает без доп. данных).
    if openssl enc -aes-256-cbc -pbkdf2 -iter "${BACKUP_PBKDF2_ITERATIONS}" -salt \
        -in "${src}" -out "${dest}" -pass "file:${BACKUP_PASSPHRASE_FILE}" 2>/dev/null; then
        chmod 600 "${dest}" 2>/dev/null || true
        echo "${dest}"
        return 0
    fi

    backup_crypto_warn_once "не удалось зашифровать ${src} — выгружаем как есть"
    rm -f "${dest}" 2>/dev/null || true
    echo "${src}"
    return 0
}

# Готовит зашифрованные копии для всех аргументов и печатает список путей.
# Используется, когда удобнее передать сразу набор файлов.
encrypt_backup_all() {
    local file
    for file in "$@"; do
        [ -n "${file}" ] || continue
        encrypt_backup "${file}"
    done
}
